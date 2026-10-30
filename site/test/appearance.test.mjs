import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {PRESETS,PATTERNS,resolveAppearance,appearanceRuntime} from '../lib/fm1-appearance.mjs';

function luminance(hex){const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
function assertReadable(theme){
  const v=theme.variables;
  const pattern=v['--pattern-rgb'].split(',').map(Number),alpha=Number(v['--pattern-opacity']);
  const peak='#'+[1,3,5].map((offset,i)=>Math.round(parseInt(v['--paper'].slice(offset,offset+2),16)*(1-alpha)+pattern[i]*alpha).toString(16).padStart(2,'0')).join('');
  for(const background of [v['--paper'],v['--surface'],v['--surface-alt'],v['--header'],v['--input'],peak]){
    for(const key of ['--ink','--muted','--accent-ink'])assert.ok(contrast(v[key],background)>=4.5,`${theme.preset}: ${key} ${v[key]} on ${background}`);
    for(const key of ['--line','--focus'])assert.ok(contrast(v[key],background)>=3,`${theme.preset}: ${key} ${v[key]} on ${background}`);
  }
  assert.ok(contrast(v['--button-ink'],v['--accent'])>=4.5,`Button label on ${theme.accent}`);
}

test('every FM-1 preset has readable text, controls and accent labels',()=>{
  assert.equal(PRESETS.length,13);
  assert.equal(new Set(PRESETS.map(p=>p.id)).size,13);
  for(const preset of PRESETS){const theme=resolveAppearance({preset:preset.id});assert.equal(theme.scheme,preset.scheme);assert.equal(theme.preset,preset.id);assertReadable(theme);}
});

test('custom RGB backgrounds and accents remain readable at extremes and contrast crossover',()=>{
  for(const background of ['#000000','#ffffff','#777777','#757575','#767676','#ff0000','#00ff00','#0000ff','#ffff00','#00ffff','#ff00ff','#808080']){
    for(const accent of ['#000000','#ffffff','#777777','#ff0000','#00ff00','#0000ff']){
      const theme=resolveAppearance({preset:'custom',background,accent,pattern:'dots'});
      assert.equal(theme.preset,'custom');assert.equal(theme.background,background);assert.equal(theme.accent,accent);assertReadable(theme);
    }
  }
});

test('unsupported palette, pattern and malformed CSS values fall back without injection',()=>{
  const fallback=resolveAppearance();
  for(const input of [null,[],{preset:'missing',pattern:'url(https://example.com)',background:'red;display:none',accent:'#123'},{background:{toString:()=>{throw new Error('must not coerce');}},accent:'</script>'}])assert.deepEqual(resolveAppearance(input),fallback);
  const valid=resolveAppearance({preset:'custom',background:'#FfAa00',accent:'#00AbCD',pattern:'scanlines'});
  assert.equal(valid.background,'#ffaa00');assert.equal(valid.accent,'#00abcd');assert.equal(valid.pattern,'scanlines');assert.equal(valid.preset,'custom');
  assert.equal(PATTERNS.length,5);
  const paper=resolveAppearance({preset:'paper'});
  assert.deepEqual(resolveAppearance({...paper}),paper);
  assert.deepEqual(resolveAppearance({preset:'paper',background:'#000000',accent:'#ffffff'}),paper);
});

test('embedded appearance runtime is self-contained and preserves server resolver behavior',()=>{
  const context=vm.createContext({window:{}});vm.runInContext(appearanceRuntime,context);
  const input={preset:'royal-violet',pattern:'circuit-grid'};
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.FM1Appearance.resolveAppearance(input))),resolveAppearance(input));
});
