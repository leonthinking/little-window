import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
const files = (await fs.readdir(root)).filter(name => /\.(js|html|css)$/.test(name));
files.push('manifest.json', 'icons', '_locales', 'LICENSE', 'PRIVACY.md');
await fs.mkdir(path.join(root, 'dist'), {recursive: true});
const output = path.join(root, 'dist', `little-window-${manifest.version}.zip`);
execFileSync('python3', ['-c', `
import sys, pathlib, zipfile
root=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED) as archive:
    for entry in sys.argv[3:]:
        p=root/entry
        for f in sorted(p.rglob('*')) if p.is_dir() else [p]:
            if f.is_file() and not f.name.startswith('.'):
                archive.write(f, pathlib.Path('little-window')/f.relative_to(root))
`, root, output, ...files]);
console.log(path.relative(root, output));
