/** A self-contained palette engine, shared by the server and inline panel. */
function createAppearanceEngine() {
  const PRESETS = Object.freeze([
    { id:'forge-black', name:'Forge Black', scheme:'dark', background:'#000000', accent:'#a3efcc' },
    { id:'fm1-mint', name:'FM1 Mint', scheme:'dark', background:'#101a18', accent:'#a3efcc' },
    { id:'mint-light', name:'Mint Light', scheme:'light', background:'#edf8f1', accent:'#16744f' },
    { id:'midnight-blue', name:'Midnight Blue', scheme:'dark', background:'#0c1729', accent:'#86baff' },
    { id:'ocean-cyan', name:'Ocean Cyan', scheme:'dark', background:'#09262b', accent:'#67e6eb' },
    { id:'royal-violet', name:'Royal Violet', scheme:'dark', background:'#21162f', accent:'#c3a2ff' },
    { id:'sakura-pink', name:'Sakura Pink', scheme:'light', background:'#fff0f5', accent:'#a32d67' },
    { id:'signal-red', name:'Signal Red', scheme:'dark', background:'#2b1418', accent:'#ff9098' },
    { id:'amber', name:'Amber', scheme:'dark', background:'#271f0e', accent:'#f4c566' },
    { id:'forest-green', name:'Forest Green', scheme:'dark', background:'#142419', accent:'#9bdfa5' },
    { id:'graphite', name:'Graphite', scheme:'dark', background:'#202226', accent:'#d5dce5' },
    { id:'paper', name:'Paper', scheme:'light', background:'#f6f5ee', accent:'#995127' },
    { id:'high-contrast', name:'High Contrast', scheme:'dark', background:'#000000', accent:'#b3ffd9' },
  ].map(Object.freeze));
  const PATTERNS = Object.freeze([
    { id:'solid', name:'Solid' },
    { id:'circuit-grid', name:'Circuit Grid' },
    { id:'dots', name:'Dots' },
    { id:'scanlines', name:'Scanlines' },
    { id:'diagonal-stripes', name:'Diagonal Stripes' },
  ].map(Object.freeze));
  const rgb = hex => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
  const hex = values => '#'+values.map(value=>Math.round(value).toString(16).padStart(2,'0')).join('');
  const mix = (a,b,amount) => hex(rgb(a).map((value,i)=>value*(1-amount)+rgb(b)[i]*amount));
  function luminance(color) {
    const channels=rgb(color).map(value=>{const c=value/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;});
    return channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
  }
  function contrast(a,b) {
    const first=luminance(a),second=luminance(b);
    return (Math.max(first,second)+0.05)/(Math.min(first,second)+0.05);
  }
  function readable(color,backgrounds,target,fallback) {
    if(backgrounds.every(background=>contrast(color,background)>=target))return color;
    // Preserve hue as far as the contrast target permits, then approach the proven foreground.
    for(let step=1;step<=100;step++){
      const candidate=mix(color,fallback,step/100);
      if(backgrounds.every(background=>contrast(candidate,background)>=target))return candidate;
    }
    return fallback;
  }
  function normalize(value,fallback) {
    return typeof value==='string'&&/^#[a-f0-9]{6}$/i.test(value)?value.toLowerCase():fallback;
  }
  function resolveAppearance(input={}) {
    if(!input||typeof input!=='object'||Array.isArray(input))input={};
    const knownPreset=PRESETS.find(preset=>preset.id===input.preset),selected=knownPreset||PRESETS[0];
    const background=knownPreset?selected.background:normalize(input.background,selected.background);
    const accent=knownPreset?selected.accent:normalize(input.accent,selected.accent);
    const customized=input.preset==='custom'||background!==selected.background||accent!==selected.accent;
    const pattern=PATTERNS.some(value=>value.id===input.pattern)?input.pattern:'solid';
    const pureInk=contrast('#ffffff',background)>contrast('#000000',background)?'#ffffff':'#000000';
    const scheme=pureInk==='#ffffff'?'dark':'light',away=pureInk==='#ffffff'?'#000000':'#ffffff';
    const safeSurface=amount=>{
      const candidate=mix(background,pureInk,amount);
      return contrast(candidate,pureInk)>=4.5?candidate:mix(background,away,amount);
    };
    const surface=safeSurface(.055),surfaceAlt=safeSurface(.09),header=safeSurface(.025);
    // At the black/white crossover, draw the pattern away from text rather than reduce contrast.
    const patternColor=contrast(mix(background,pureInk,.045),pureInk)>=4.5?pureInk:away;
    const patternPeak=mix(background,patternColor,.045);
    const backgrounds=[background,surface,surfaceAlt,header,patternPeak];
    const ink=readable(scheme==='dark'?'#ecf7f1':'#111c18',backgrounds,4.5,pureInk);
    const muted=readable(mix(background,ink,.68),backgrounds,4.5,ink);
    const line=readable(mix(background,ink,.33),backgrounds,3,ink);
    const accentInk=readable(accent,backgrounds,4.5,ink);
    const focus=readable(accent,backgrounds,3,ink);
    const buttonInk=contrast('#ffffff',accent)>contrast('#000000',accent)?'#ffffff':'#000000';
    return {
      preset:customized?'custom':selected.id,pattern,scheme,background,accent,
      variables:{
        '--paper':background,'--ink':ink,'--muted':muted,'--line':line,'--accent':accent,
        '--accent-ink':accentInk,'--button-ink':buttonInk,'--green':accentInk,
        '--surface':surface,'--surface-alt':surfaceAlt,'--header':header,'--input':background,
        '--focus':focus,'--pattern-rgb':rgb(patternColor).join(','),'--pattern-opacity':'.045',
        '--backdrop':scheme==='dark'?'#00000099':'#15201b88',
      },
    };
  }
  return {PRESETS,PATTERNS,resolveAppearance};
}

const engine=createAppearanceEngine();
export const { PRESETS, PATTERNS, resolveAppearance }=engine;
// The initializer has no module references or DOM dependencies and makes no host/service calls.
export const appearanceRuntime='window.FM1Appearance=('+createAppearanceEngine.toString()+')();';

/** Colour overrides follow the existing layout CSS; UI controls remain root-owned. */
export const appearanceCss=String.raw`
html{background:#000000;min-height:100%;color-scheme:dark}
html,body{min-height:100vh;min-height:100dvh}
body[data-appearance]{background-color:var(--paper);color:var(--ink);background-image:none}
/* Native hosts can make the document canvas transparent. Paint an app-owned
   surface so headings, controls and gaps always use the selected palette. */
#fm1-shell{display:flow-root;width:100%;min-height:100vh;min-height:100dvh;background-color:var(--paper,#000000);color:var(--ink,#ecf7f1);background-image:none;color-scheme:inherit}
body[data-appearance][data-scheme="dark"]{color-scheme:dark}
body[data-appearance][data-scheme="light"]{color-scheme:light}
body[data-appearance][data-pattern="circuit-grid"] #fm1-shell{background-image:linear-gradient(rgba(var(--pattern-rgb),var(--pattern-opacity)) 1px,transparent 1px),linear-gradient(90deg,rgba(var(--pattern-rgb),var(--pattern-opacity)) 1px,transparent 1px);background-size:24px 24px}
body[data-appearance][data-pattern="dots"] #fm1-shell{background-image:radial-gradient(circle,rgba(var(--pattern-rgb),var(--pattern-opacity)) 1.5px,transparent 1.6px);background-size:15px 15px}
body[data-appearance][data-pattern="scanlines"] #fm1-shell{background-image:repeating-linear-gradient(0deg,rgba(var(--pattern-rgb),var(--pattern-opacity)),rgba(var(--pattern-rgb),var(--pattern-opacity)) 1px,transparent 1px,transparent 5px);background-size:auto}
body[data-appearance][data-pattern="diagonal-stripes"] #fm1-shell{background-image:repeating-linear-gradient(135deg,rgba(var(--pattern-rgb),var(--pattern-opacity)),rgba(var(--pattern-rgb),var(--pattern-opacity)) 4px,transparent 4px,transparent 18px);background-size:auto}
body[data-appearance] header{background:var(--header);border-color:var(--line)}
body[data-appearance] .brand span{color:var(--ink)}
body[data-appearance] .brand>span:last-child>span:last-child{color:var(--muted)!important}
body[data-appearance] .brand svg{color:var(--accent-ink)}
body[data-appearance] .card,body[data-appearance] .panel,body[data-appearance] dialog{background:var(--surface);border-color:var(--line);color:var(--ink)}
body[data-appearance] .saved{background:var(--header);border:1px solid var(--line);color:var(--ink)}
body[data-appearance] .saved header{background:transparent}
body[data-appearance] .badge,body[data-appearance] .confirmation{background:var(--surface-alt);color:var(--ink)}
body[data-appearance] .state,body[data-appearance] .jobline{border-color:var(--line)}
body[data-appearance] .jobline button{color:var(--ink)}
body[data-appearance] .icon,body[data-appearance] .icon.doom,body[data-appearance] .icon.mdx,body[data-appearance] .icon.buddha,body[data-appearance] .icon.protracker{background:var(--surface-alt);color:var(--accent-ink)}
body[data-appearance] input,body[data-appearance] select{background:var(--input);border-color:var(--line);color:var(--ink)}
body[data-appearance] textarea{background:var(--input);border:1px solid var(--line);color:var(--ink);font:inherit;width:100%;padding:9px 10px;border-radius:6px;resize:vertical}
body[data-appearance] input::placeholder{color:var(--muted);opacity:1}
body[data-appearance] .primary{background:var(--accent);border-color:var(--focus);color:var(--button-ink)}
body[data-appearance] .secondary{background:transparent;border-color:var(--line);color:var(--ink)}
body[data-appearance] .muted,body[data-appearance] .note,body[data-appearance] .digest,body[data-appearance] .tag,body[data-appearance] .empty,body[data-appearance] .card p,body[data-appearance] footer,body[data-appearance] #count,body[data-appearance] #requests>p{color:var(--muted)!important}
body[data-appearance] .eyebrow,body[data-appearance] .message{color:var(--accent-ink)}
body[data-appearance] .dot{background:var(--muted)}
body[data-appearance] .online .dot{background:var(--accent-ink)}
body[data-appearance] progress{accent-color:var(--accent-ink)}
body[data-appearance] dialog::backdrop{background:var(--backdrop)}
body[data-appearance] button:focus-visible,body[data-appearance] input:focus-visible,body[data-appearance] select:focus-visible,body[data-appearance] a:focus-visible{outline-color:var(--focus)}
.appearance-controls{margin:0 0 22px;border:1px solid var(--line);border-radius:13px;background:var(--header)}
.appearance-controls>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 16px;cursor:pointer;font-size:13px;font-weight:650;list-style:none}
.appearance-controls>summary::-webkit-details-marker{display:none}
.appearance-controls>summary::before{content:'\25B8';color:var(--accent-ink)}
.appearance-controls[open]>summary::before{content:'\25BE'}
.appearance-controls>summary>span{margin-left:auto;color:var(--muted);font-size:12px;font-weight:400;text-align:right}
.appearance-controls>summary:focus-visible{outline:3px solid var(--focus);outline-offset:3px;border-radius:12px}
.appearance-content{padding:4px 16px 17px;border-top:1px solid var(--line)}
.appearance-content h2{margin:13px 0 0;font-size:17px}
.appearance-content>.note{margin-top:6px}
.palette-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:15px 0}
.palette-choice{display:flex;align-items:center;gap:10px;min-height:61px;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);text-align:left;font-size:12px;font-weight:600;line-height:1.3}
.palette-choice[aria-pressed="true"]{background:var(--surface-alt);box-shadow:inset 0 0 0 2px var(--focus)}
.palette-choice:hover{background:var(--surface-alt)}
.palette-swatch{display:inline-flex;flex:0 0 43px;width:43px;height:34px;border:1px solid;border-radius:7px;align-items:center;justify-content:center;box-shadow:0 0 0 1px var(--line)}
.palette-swatch>span{display:block;width:25px;height:10px;border-radius:3px}
.appearance-fields{display:grid;grid-template-columns:1fr 1fr 1fr;gap:13px}
.appearance-fields label{display:block;margin:0 0 6px;font-size:12px;color:var(--muted)}
.colour-field{display:grid;grid-template-columns:39px minmax(0,1fr);gap:6px}
.colour-field input[type="color"]{width:39px;height:40px;padding:3px;cursor:pointer}
.colour-field input:not([type="color"]){font-family:ui-monospace,Consolas,monospace;font-size:12px;min-width:0}
.appearance-bottom{display:flex;align-items:center;gap:14px;margin-top:15px}
.appearance-bottom>.note{margin:0;font-size:11px}
.appearance-bottom>.secondary{flex-shrink:0}
@media(max-width:760px){.palette-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.appearance-fields{grid-template-columns:1fr 1fr}.appearance-fields>div:first-child{grid-column:1/-1}}
@media(max-width:460px){.palette-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.appearance-fields{grid-template-columns:1fr}.appearance-bottom{align-items:flex-start;flex-direction:column;gap:8px}.palette-choice{gap:7px;padding:8px}.appearance-controls>summary{align-items:flex-start}}
`;
