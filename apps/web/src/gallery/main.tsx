import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/index.css';
import { UIProvider } from '../components/ui';
import { SECTION_COLORS, applyAccent, type SectionColorId } from '../theme/sections';
import { applyAppearance, type GlassMode, type ThemeMode } from '../theme/theme';
import { Gallery } from './Gallery';

// Development-only page (not part of the production build). URL parameters fix
// the appearance for visual tests: ?theme=dark&glass=off&accent=teal
const params = new URLSearchParams(location.search);
const theme = (params.get('theme') ?? 'system') as ThemeMode;
const glass = (params.get('glass') ?? 'auto') as GlassMode;
const accent = params.get('accent') as SectionColorId | null;
applyAppearance({ theme, glass });
applyAccent(accent && SECTION_COLORS.some((c) => c.id === accent) ? accent : 'blue');

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element');

createRoot(rootElement).render(
  <StrictMode>
    <UIProvider>
      <Gallery initialTheme={theme} initialGlass={glass} />
    </UIProvider>
  </StrictMode>,
);
