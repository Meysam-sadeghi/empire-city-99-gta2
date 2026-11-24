import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { GameEngine } from './engine/GameEngine';
import { App } from './ui/App';

async function bootstrap(): Promise<void> {
  const canvasContainer = document.getElementById('game-canvas-container');
  const rootEl = document.getElementById('root');
  if (!canvasContainer || !rootEl) {
    throw new Error('Missing #game-canvas-container or #root mount elements');
  }

  const engine = new GameEngine(canvasContainer);
  await engine.init();

  const root = createRoot(rootEl);
  root.render(React.createElement(App, { engine }));
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap Empire City 99:', err);
});
