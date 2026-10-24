import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../styles.css', import.meta.url),'utf8');
function luminance(hex) {
  const c = hex.match(/[a-f\d]{2}/gi).map(x=>parseInt(x,16)/255).map(x=>x<=.04045 ? x/12.92 : ((x+.055)/1.055)**2.4);
  return .2126*c[0]+.7152*c[1]+.0722*c[2];
}
function ratio(a,b) { const values=[luminance(a),luminance(b)].sort((x,y)=>y-x); return (values[0]+.05)/(values[1]+.05); }
test('light muted copy and input placeholder meet 4.5:1 contrast',()=>{
  const variable = name => css.match(new RegExp(`--${name}: (#[a-f\\d]{6})`,'i'))[1];
  const placeholder = css.match(/#query::placeholder \{ color: (#[a-f\d]{6})/i)[1];
  for(const background of ['surface','field']) {
    const contrast=ratio(variable('muted'),variable(background));
    assert.ok(contrast>=4.5,`${background}: ${contrast}`);
  }
  const contrast=ratio(placeholder,variable('field'));
  assert.ok(contrast>=4.5,`placeholder: ${contrast}`);
});
