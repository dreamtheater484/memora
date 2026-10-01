import { resolvedTheme, useTheme } from '../theme/theme';
import type { DiagramTheme } from './theme';

/** The look diagrams are drawn in: the app's light or dark. */
export const useDiagramTheme = (): DiagramTheme => resolvedTheme(useTheme((s) => s.theme));
