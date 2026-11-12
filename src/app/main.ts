import { mount } from 'svelte';
import { createRenderer } from '../render/renderer.ts';
import { dayLabel } from '../sim/placeholder.ts';
import Panel from '../ui/Panel.svelte';

const host = document.getElementById('app');
if (!host) throw new Error('#app element missing from index.html');

await createRenderer(host);
mount(Panel, { target: host, props: { day: dayLabel(1) } });
