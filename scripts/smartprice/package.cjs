const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),archiver=require('archiver');
const out=path.resolve('../../outputs');fs.mkdirSync(out,{recursive:true});
const files=cp.execFileSync('git',['ls-files','-c','-o','--exclude-standard','-z'],{maxBuffer:10*1024*1024}).toString('utf8').split('\0').filter(Boolean);
const output=fs.createWriteStream(path.join(out,'SMART-PRICE.zip'));const archive=archiver('zip',{zlib:{level:9}});archive.on('error',e=>{throw e});output.on('close',()=>console.log('Archive ready:',archive.pointer(),'bytes;',files.length,'source files'));archive.pipe(output);
for(const f of new Set(files))if(fs.statSync(f).isFile())archive.file(f,{name:'SMART-PRICE/'+f});archive.finalize();
for(const [from,to] of [['SMART_PRICE.md','README-SMART-PRICE.md'],['docs/smartprice/PITCH.md','Сценарий-защиты.md'],['docs/smartprice/ARCHITECTURE.md','Архитектура.md']])fs.copyFileSync(from,path.join(out,to));
fs.writeFileSync(path.join(out,'Публичная-ссылка.txt'),'SMART PRICE\nhttps://strict-dimensional-walker-around.trycloudflare.com\n\nСсылка временная. Работает, пока запущены сервер и Cloudflare Tunnel на этом компьютере.\nДемо-вход по роли открыт. Все посетители используют общий набор тестовых данных.\nДля постоянного размещения используйте Node.js 24 хостинг с постоянным диском; Dockerfile включён в архив.\n','utf8');
