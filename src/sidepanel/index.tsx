import React from 'react';
import { createRoot } from 'react-dom/client';
import { SidePanel } from './SidePanel';

const root = document.getElementById('root')!;
createRoot(root).render(<SidePanel />);
