"""Assemble compiled bundles with the official Electron ZIP and bundled Python."""
from pathlib import Path
import json, shutil, sys, zipfile

source=Path(__file__).resolve().parent
runtime=Path(sys.argv[1]).resolve()
target=Path(sys.argv[2]).resolve()
if target.exists():
    raise SystemExit('Use a new output folder to preserve existing files.')
target.mkdir(parents=True)
if runtime.is_dir():
    shutil.copytree(runtime,target,dirs_exist_ok=True)
else:
    with zipfile.ZipFile(runtime) as archive:
        archive.extractall(target)
(target/'electron.exe').rename(target/'MesaDoMestre.exe')
if (target/'electron.exe.sig').exists():
    (target/'electron.exe.sig').rename(target/'MesaDoMestre.exe.sig')
app=target/'resources/app'
app.mkdir(parents=True)
shutil.copytree(source/'.webpack/main',app/'.webpack/main')
shutil.copytree(source/'.webpack/renderer',app/'.webpack/renderer')
package=json.loads((source/'package.json').read_text())
(app/'package.json').write_text(json.dumps({k:package[k] for k in ['name','productName','version','main','license']}))
seen=set()
def copy_dependency(name, parent, optional=False):
    for folder in [parent,*parent.parents]:
        if not folder.is_relative_to(source): break
        candidate=folder/'node_modules'/name
        if (candidate/'package.json').exists(): break
    else: candidate=None
    if candidate is None or not (candidate/'package.json').exists():
        if optional: return
        raise RuntimeError('Missing dependency: '+name)
    if candidate in seen: return
    seen.add(candidate)
    metadata=json.loads((candidate/'package.json').read_text())
    if metadata.get('os') and 'win32' not in metadata['os']: return
    if metadata.get('cpu') and 'x64' not in metadata['cpu']: return
    shutil.copytree(candidate,app/candidate.relative_to(source),ignore=shutil.ignore_patterns('node_modules'),dirs_exist_ok=True)
    optional_names=metadata.get('optionalDependencies',{})
    for dep in metadata.get('dependencies',{}): copy_dependency(dep,candidate,dep in optional_names)
    for dep in optional_names: copy_dependency(dep,candidate,True)
for name in ['@discordjs/voice','opusscript','prism-media','@snazzah/davey','libsodium-wrappers']:
    copy_dependency(name,source)
for name in ['campaign','python']:
    shutil.copytree(source/name,target/'resources'/name,ignore=shutil.ignore_patterns('__pycache__','data'))
for name in ['LICENSE','MODIFICACOES.md','DADOS-E-CONTINUIDADE.md']:
    shutil.copy2(source/name,target/name)
shutil.copy2(source/'src/main/dice/vendor/LICENSE',target/'LICENSE-Rollem.txt')
print('Portable app assembled:',target)
