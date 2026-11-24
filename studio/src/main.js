import '../tokens.css';
import '../styles.css';
import { mount } from 'svelte';
import App from './App.svelte';

if (typeof window.WebGL2RenderingContext === 'function') import('../js/restaurant.js').catch(() => {});

mount(App, { target: document.body });
