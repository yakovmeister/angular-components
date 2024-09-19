/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {Rule, SchematicContext, Tree} from '@angular-devkit/schematics';
import {Schema} from './schema';
import {
  argbFromHex,
  hexFromArgb,
  TonalPalette,
  Hct,
  SchemeContent,
} from '@material/material-color-utilities';

// For each color tonal palettes are created using the following hue tones. The
// tonal palettes then get used to create the different color roles (ex.
// on-primary) https://m3.material.io/styles/color/system/how-the-system-works
const HUE_TONES = [0, 10, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 95, 98, 99, 100];
// Map of neutral hues to the previous/next hues that
// can be used to estimate them, in case they're missing.
const NEUTRAL_HUES = new Map<number, {prev: number; next: number}>([
  [4, {prev: 0, next: 10}],
  [6, {prev: 0, next: 10}],
  [12, {prev: 10, next: 20}],
  [17, {prev: 10, next: 20}],
  [22, {prev: 20, next: 25}],
  [24, {prev: 20, next: 25}],
  [87, {prev: 80, next: 90}],
  [92, {prev: 90, next: 95}],
  [94, {prev: 90, next: 95}],
  [96, {prev: 95, next: 98}],
]);

// Note: Some of the color tokens refer to additional hue tones, but this only
// applies for the neutral color palette (ex. surface container is neutral
// palette's 94 tone). https://m3.material.io/styles/color/static/baseline
const NEUTRAL_HUE_TONES = [...HUE_TONES, ...NEUTRAL_HUES.keys()];

/**
 * Gets color tonal palettes generated by Material from the provided color.
 * @param color Color that represent primary to generate all the tonal palettes.
 * @returns Object with tonal palettes for each color
 */
function getMaterialTonalPalettes(color: string): {
  primary: TonalPalette;
  secondary: TonalPalette;
  tertiary: TonalPalette;
  neutral: TonalPalette;
  neutralVariant: TonalPalette;
  error: TonalPalette;
} {
  try {
    let argbColor = argbFromHex(color);
    const scheme = new SchemeContent(
      Hct.fromInt(argbColor),
      false, // Tonal palettes are the same for light and dark themes
      0.0,
    );

    return {
      primary: scheme.primaryPalette,
      secondary: scheme.secondaryPalette,
      tertiary: scheme.tertiaryPalette,
      neutral: scheme.neutralPalette,
      neutralVariant: scheme.neutralVariantPalette,
      error: scheme.errorPalette,
    };
  } catch (e) {
    throw new Error(
      'Cannot parse the specified color ' +
        color +
        '. Please verify it is a hex color (ex. #ffffff or ffffff).',
    );
  }
}

/**
 * Gets map of all the color tonal palettes from a specified color.
 * @param color Color that represent primary to generate the color tonal palettes.
 * @returns Map with the colors and their hue tones and values.
 */
function getColorTonalPalettes(color: string): Map<string, Map<number, string>> {
  const tonalPalettes = getMaterialTonalPalettes(color);
  const palettes: Map<string, Map<number, string>> = new Map();
  for (const [key, palette] of Object.entries(tonalPalettes)) {
    const paletteKey = key.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    const tones = paletteKey === 'neutral' ? NEUTRAL_HUE_TONES : HUE_TONES;
    const colorPalette: Map<number, string> = new Map();
    for (const tone of tones) {
      const color = hexFromArgb(palette.tone(tone));
      colorPalette.set(tone, color);
    }
    palettes.set(paletteKey, colorPalette);
  }
  return palettes;
}

/**
 * Gets the scss representation of the provided color palettes.
 * @param colorPalettes Map of colors and their hue tones and values.
 * @returns String of the color palettes scss.
 */
function getColorPalettesSCSS(colorPalettes: Map<string, Map<number, string>>): string {
  let scss = '(\n';
  for (const [variant, palette] of colorPalettes!.entries()) {
    scss += '  ' + variant + ': (\n';
    for (const [key, value] of palette.entries()) {
      scss += '    ' + key + ': ' + value + ',\n';
    }
    scss += '  ),\n';
  }
  scss += ');';
  return scss;
}

/**
 * Gets the generated scss from the provided color palettes and theme types.
 * @param colorPalettes Map of colors and their hue tones and values.
 * @param themeTypes Theme types for the theme (ex. 'light', 'dark', or 'both').
 * @param colorComment Comment with original hex colors used to generate palettes.
 * @param useSystemVariables Whether to use system-level variables in the generated theme.
 * @returns String of the generated theme scss.
 */
export function generateSCSSTheme(
  colorPalettes: Map<string, Map<number, string>>,
  themeTypes: string,
  colorComment: string,
  useSystemVariables: boolean,
): string {
  let scss = [
    "// This file was generated by running 'ng generate @angular/material:m3-theme'.",
    '// Proceed with caution if making changes to this file.',
    '',
    "@use 'sass:map';",
    "@use '@angular/material' as mat;",
    '',
    '// Note: ' + colorComment,
    '$_palettes: ' + getColorPalettesSCSS(patchMissingHues(colorPalettes)),
    '',
    '$_rest: (',
    '  secondary: map.get($_palettes, secondary),',
    '  neutral: map.get($_palettes, neutral),',
    '  neutral-variant: map.get($_palettes,  neutral-variant),',
    '  error: map.get($_palettes, error),',
    ');',
    '$_primary: map.merge(map.get($_palettes, primary), $_rest);',
    '$_tertiary: map.merge(map.get($_palettes, tertiary), $_rest);',
    '',
  ];

  let themes = themeTypes === 'both' ? ['light', 'dark'] : [themeTypes];
  // Note: Call define-theme function here since creating the color tokens
  // from the palettes is a private function
  for (const themeType of themes) {
    scss = scss.concat([
      '$' + themeType + '-theme: mat.define-theme((',
      '  color: (',
      '    theme-type: ' + themeType + ',',
      '    primary: $_primary,',
      '    tertiary: $_tertiary,',
      ...(useSystemVariables ? ['    use-system-variables: true,'] : []),
      '  ),',
      ...(useSystemVariables ? ['  typography: (', '    use-system-variables: true,', '  ),'] : []),
      '));',
    ]);
  }
  return scss.join('\n');
}

/**
 * Creates theme file for provided scss.
 * @param scss scss for the theme file.
 * @param tree Directory tree.
 * @param directory Directory path to place generated theme file.
 */
function createThemeFile(scss: string, tree: Tree, directory?: string) {
  const filePath = directory ? directory + 'm3-theme.scss' : 'm3-theme.scss';
  tree.create(filePath, scss);
}

export default function (options: Schema): Rule {
  return async (tree: Tree, context: SchematicContext) => {
    const colorPalettes = getColorTonalPalettes(options.primaryColor);
    let colorComment = 'Color palettes are generated from primary: ' + options.primaryColor;

    if (options.secondaryColor) {
      colorPalettes.set('secondary', getColorTonalPalettes(options.secondaryColor).get('primary')!);
      colorComment += ', secondary: ' + options.secondaryColor;
    }
    if (options.tertiaryColor) {
      colorPalettes.set('tertiary', getColorTonalPalettes(options.tertiaryColor).get('primary')!);
      colorComment += ', tertiary: ' + options.tertiaryColor;
    }
    if (options.neutralColor) {
      colorPalettes.set('neutral', getColorTonalPalettes(options.neutralColor).get('primary')!);
      colorComment += ', neutral: ' + options.neutralColor;
    }

    if (!options.themeTypes) {
      context.logger.info('No theme types specified, creating both light and dark themes.');
      options.themeTypes = 'both';
    }

    const themeScss = generateSCSSTheme(
      colorPalettes,
      options.themeTypes,
      colorComment,
      options.useSystemVariables || false,
    );
    createThemeFile(themeScss, tree, options.directory);
  };
}

/**
 * The hue map produced by `material-color-utilities` may miss some neutral hues depending on
 * the provided colors. This function estimates the missing hues based on the generated ones
 * to ensure that we always produce a full palette. See #29157.
 *
 * This is a TypeScript port of the logic in `core/theming/_palettes.scss#_patch-missing-hues`.
 */
function patchMissingHues(
  palettes: Map<string, Map<number, string>>,
): Map<string, Map<number, string>> {
  const neutral = palettes.get('neutral');

  if (!neutral) {
    return palettes;
  }

  let newNeutral: Map<number, string> | null = null;

  for (const [hue, {prev, next}] of NEUTRAL_HUES) {
    if (!neutral.has(hue) && neutral.has(prev) && neutral.has(next)) {
      const weight = (next - hue) / (next - prev);
      const result = mixColors(neutral.get(prev)!, neutral.get(next)!, weight);

      if (result !== null) {
        newNeutral ??= new Map(neutral.entries());
        newNeutral.set(hue, result);
      }
    }
  }

  if (!newNeutral) {
    return palettes;
  }

  // Create a new map so we don't mutate the one that was passed in.
  const newPalettes = new Map<string, Map<number, string>>();
  for (const [key, value] of palettes) {
    if (key === 'neutral') {
      // Maps keep the order of their keys which can make the newly-added
      // ones look out of place. Re-sort the the keys in ascending order.
      const sortedNeutral = Array.from(newNeutral.keys())
        .sort((a, b) => a - b)
        .reduce((newHues, key) => {
          newHues.set(key, newNeutral.get(key)!);
          return newHues;
        }, new Map<number, string>());
      newPalettes.set(key, sortedNeutral);
    } else {
      newPalettes.set(key, value);
    }
  }

  return newPalettes;
}

/**
 * TypeScript port of the `color.mix` function from Sass, simplified to only deal with hex colors.
 * See https://github.com/sass/dart-sass/blob/main/lib/src/functions/color.dart#L803
 *
 * @param c1 First color to use in the mixture.
 * @param c2 Second color to use in the mixture.
 * @param weight Proportion of the first color to use in the mixture.
 *    Should be a number between 0 and 1.
 */
function mixColors(c1: string, c2: string, weight: number): string | null {
  const normalizedWeight = weight * 2 - 1;
  const weight1 = (normalizedWeight + 1) / 2;
  const weight2 = 1 - weight1;
  const color1 = parseHexColor(c1);
  const color2 = parseHexColor(c2);

  if (color1 === null || color2 === null) {
    return null;
  }

  const red = Math.round(color1.red * weight1 + color2.red * weight2);
  const green = Math.round(color1.green * weight1 + color2.green * weight2);
  const blue = Math.round(color1.blue * weight1 + color2.blue * weight2);
  const intToHex = (value: number) => value.toString(16).padStart(2, '0');

  return `#${intToHex(red)}${intToHex(green)}${intToHex(blue)}`;
}

/** Parses a hex color to its numeric red, green and blue values. */
function parseHexColor(value: string): {red: number; green: number; blue: number} | null {
  if (!/^#(?:[0-9a-fA-F]{3}){1,2}$/.test(value)) {
    return null;
  }

  const hexToInt = (value: string) => parseInt(value, 16);
  let red: number;
  let green: number;
  let blue: number;

  if (value.length === 4) {
    red = hexToInt(value[1] + value[1]);
    green = hexToInt(value[2] + value[2]);
    blue = hexToInt(value[3] + value[3]);
  } else {
    red = hexToInt(value.slice(1, 3));
    green = hexToInt(value.slice(3, 5));
    blue = hexToInt(value.slice(5, 7));
  }

  return {red, green, blue};
}
