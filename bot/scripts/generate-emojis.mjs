import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '..', 'src', 'assets', 'emoji');

const SIZE = 128;
const SCALE = 3;

function lucide(paths, { from, to } = {}) {
  const fill = from || '#6366f1';
  const toColor = to || fill;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${fill}"/><stop offset="100%" stop-color="${toColor}"/>
  </linearGradient></defs>
  <rect x="4" y="4" width="${SIZE - 8}" height="${SIZE - 8}" rx="28" fill="url(#bg)"/>
  <g transform="translate(${(SIZE - 24 * SCALE) / 2}, ${(SIZE - 24 * SCALE) / 2}) scale(${SCALE})">
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
${paths.split('\n').filter(Boolean).map(l => `      ${l}`).join('\n')}
    </svg>
  </g>
</svg>`;
}

const EMOJIS = [
  {
    name: 'gapat_ai',
    paths: `<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>
<path d="M20 2v4"/>
<path d="M22 4h-4"/>
<circle cx="4" cy="20" r="2"/>`,
    from: '#8b5cf6', to: '#6d28d9',
  },
  {
    name: 'gapat_back',
    paths: `<path d="m12 19-7-7 7-7"/>
<path d="M19 12H5"/>`,
    from: '#6366f1', to: '#4f46e5',
  },
  {
    name: 'gapat_channel',
    paths: `<line x1="4" x2="20" y1="9" y2="9"/>
<line x1="4" x2="20" y1="15" y2="15"/>
<line x1="10" x2="8" y1="3" y2="21"/>
<line x1="16" x2="14" y1="3" y2="21"/>`,
    from: '#10b981', to: '#059669',
  },
  {
    name: 'gapat_check',
    paths: `<path d="M20 6 9 17l-5-5"/>`,
    from: '#22c55e', to: '#16a34a',
  },
  {
    name: 'gapat_close',
    paths: `<path d="M18 6 6 18"/>
<path d="m6 6 12 12"/>`,
    from: '#64748b', to: '#475569',
  },
  {
    name: 'gapat_plus',
    paths: `<path d="M5 12h14"/>
<path d="M12 5v14"/>`,
    from: '#10b981', to: '#059669',
  },
  {
    name: 'gapat_edit',
    paths: `<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>
<path d="m15 5 4 4"/>`,
    from: '#3b82f6', to: '#2563eb',
  },
  {
    name: 'gapat_list',
    paths: `<path d="M3 5h.01"/>
<path d="M3 12h.01"/>
<path d="M3 19h.01"/>
<path d="M8 5h13"/>
<path d="M8 12h13"/>
<path d="M8 19h13"/>`,
    from: '#06b6d4', to: '#0891b2',
  },
  {
    name: 'gapat_trash',
    paths: `<path d="M10 11v6"/>
<path d="M14 11v6"/>
<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
<path d="M3 6h18"/>
<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
    from: '#ef4444', to: '#dc2626',
  },
  {
    name: 'gapat_sliders',
    paths: `<path d="M10 5H3"/>
<path d="M12 19H3"/>
<path d="M14 3v4"/>
<path d="M16 17v4"/>
<path d="M21 12h-9"/>
<path d="M21 19h-5"/>
<path d="M21 5h-7"/>
<path d="M8 10v4"/>
<path d="M8 12H3"/>`,
    from: '#f59e0b', to: '#d97706',
  },
  {
    name: 'gapat_usercog',
    paths: `<path d="M10 15H6a4 4 0 0 0-4 4v2"/>
<path d="m14.305 16.53.923-.382"/>
<path d="m15.228 13.852-.923-.383"/>
<path d="m16.852 12.228-.383-.923"/>
<path d="m16.852 17.772-.383.924"/>
<path d="m19.148 12.228.383-.923"/>
<path d="m19.53 18.696-.382-.924"/>
<path d="m20.772 13.852.924-.383"/>
<path d="m20.772 16.148.924.383"/>
<circle cx="18" cy="15" r="3"/>
<circle cx="9" cy="7" r="4"/>`,
    from: '#8b5cf6', to: '#7c3aed',
  },
  {
    name: 'gapat_chart',
    paths: `<path d="M3 3v16a2 2 0 0 0 2 2h16"/>
<path d="M7 16h8"/>
<path d="M7 11h12"/>
<path d="M7 6h3"/>`,
    from: '#f43f5e', to: '#e11d48',
  },
  {
    name: 'gapat_undo',
    paths: `<path d="M9 14 4 9l5-5"/>
<path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>`,
    from: '#f97316', to: '#ea580c',
  },
  {
    name: 'gapat_sync',
    paths: `<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
<path d="M21 3v5h-5"/>
<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
<path d="M8 16H3v5"/>`,
    from: '#6366f1', to: '#4f46e5',
  },
  {
    name: 'gapat_warning',
    paths: `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>
<path d="M12 9v4"/>
<path d="M12 17h.01"/>`,
    from: '#f59e0b', to: '#d97706',
  },
  {
    name: 'gapat_help',
    paths: `<circle cx="12" cy="12" r="10"/>
<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
<path d="M12 17h.01"/>`,
    from: '#3b82f6', to: '#2563eb',
  },
  {
    name: 'gapat_search',
    paths: `<path d="m21 21-4.34-4.34"/>
<circle cx="11" cy="11" r="8"/>`,
    from: '#6366f1', to: '#4f46e5',
  },
  {
    name: 'gapat_star',
    paths: `<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>`,
    from: '#fbbf24', to: '#f59e0b',
  },
  {
    name: 'gapat_bot',
    paths: `<path d="M12 8V4H8"/>
<rect width="16" height="12" x="4" y="8" rx="2"/>
<path d="M2 14h2"/>
<path d="M20 14h2"/>
<path d="M15 13v2"/>
<path d="M9 13v2"/>`,
    from: '#8b5cf6', to: '#7c3aed',
  },
  {
    name: 'gapat_user',
    paths: `<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
<circle cx="12" cy="7" r="4"/>`,
    from: '#94a3b8', to: '#64748b',
  },
  {
    name: 'gapat_message',
    paths: `<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>`,
    from: '#10b981', to: '#059669',
  },
  {
    name: 'gapat_link',
    paths: `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`,
    from: '#06b6d4', to: '#0891b2',
  },
  {
    name: 'gapat_lock',
    paths: `<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
<path d="M7 11V7a5 5 0 0 1 10 0v4"/>`,
    from: '#ef4444', to: '#dc2626',
  },
  {
    name: 'gapat_bell',
    paths: `<path d="M10.268 21a2 2 0 0 0 3.464 0"/>
<path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/>`,
    from: '#f59e0b', to: '#d97706',
  },
  {
    name: 'gapat_home',
    paths: `<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>
<path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>`,
    from: '#6366f1', to: '#4f46e5',
  },
  {
    name: 'gapat_settings',
    paths: `<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/>
<circle cx="12" cy="12" r="3"/>`,
    from: '#94a3b8', to: '#64748b',
  },
  {
    name: 'gapat_clock',
    paths: `<circle cx="12" cy="12" r="10"/>
<path d="M12 6v6l4 2"/>`,
    from: '#6366f1', to: '#4f46e5',
  },
  {
    name: 'gapat_pin',
    paths: `<path d="M20 10c0 4.993-5.539 10.193-7.527 11.799a1 1 0 0 1-.946 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0Z"/>
<circle cx="12" cy="10" r="3"/>`,
    from: '#f43f5e', to: '#e11d48',
  },
  {
    name: 'gapat_crown',
    paths: `<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/>
<path d="M5 21h14"/>`,
    from: '#fbbf24', to: '#f59e0b',
  },
  {
    name: 'gapat_fire',
    paths: `<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>`,
    from: '#f97316', to: '#ea580c',
  },
];

fs.mkdirSync(OUT, { recursive: true });

let ok = 0;
for (const { name, paths, from, to } of EMOJIS) {
  const svg = lucide(paths, { from, to });
  const dest = path.join(OUT, `${name}.png`);
  try {
    await sharp(Buffer.from(svg)).resize(SIZE, SIZE).png().toFile(dest);
    ok++;
    console.log(`✓ ${name} — ${from} → ${to}`);
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`);
  }
}

console.log(`\n✅ ${ok}/${EMOJIS.length} custom emoji generated`);
