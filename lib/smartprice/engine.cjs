const { DatabaseSync } = require('node:sqlite');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const regions = [
 ['astana','Астана','Астана',51.1694,71.4491],['almaty','Алматы','Алматы',43.2389,76.8897],
 ['shymkent','Шымкент','Шымкент',42.3155,69.5869],['karaganda','Карагандинская область','Караганда',49.8047,73.1094],
 ['aktobe','Актюбинская область','Актобе',50.2839,57.167],['atyrau','Атырауская область','Атырау',47.0945,51.9238],
 ['west','Западно-Казахстанская область','Уральск',51.2278,51.3865],['mangystau','Мангистауская область','Актау',43.6532,51.1975],
 ['kostanay','Костанайская область','Костанай',53.2144,63.6246],['north','Северо-Казахстанская область','Петропавловск',54.8753,69.1628],
 ['akmola','Акмолинская область','Кокшетау',53.2833,69.3833],['pavlodar','Павлодарская область','Павлодар',52.2873,76.9674],
 ['abay','Область Абай','Семей',50.4111,80.2275],['east','Восточно-Казахстанская область','Усть-Каменогорск',49.9483,82.6285],
 ['zhetysu','Область Жетісу','Талдыкорган',45.0156,78.3739],['almaty-region','Алматинская область','Конаев',43.8847,77.0687],
 ['zhambyl','Жамбылская область','Тараз',42.9,71.3667],['turkistan','Туркестанская область','Туркестан',43.3019,68.2692],
 ['kyzylorda','Кызылординская область','Кызылорда',44.8488,65.4823],['ulytau','Область Ұлытау','Жезказган',47.7833,67.7667]
].map(([id,name,city,lat,lng])=>({id,name,city,lat,lng}));
class AppError extends Error { constructor(code,status=400){super(code);this.status=status;} }
function assert(ok,code='invalid',status=400){if(!ok)throw new AppError(code,status);}
function text(v,max=200){assert(typeof v==='string' && v.trim().length>0 && v.length<=max);return v.trim();}
function change(current,previous){return previous ? Math.round((current-previous)/previous*10000)/100 : 0;}
function normalize(price,p){return Math.round(price/Number(p.quantity)*100)/100;}
function analyze(current,previous,market=[]){const delta=change(current,previous);const sorted=market.filter(x=>x>0).sort((a,b)=>a-b);const middle=Math.floor(sorted.length/2);const median=sorted.length?(sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2):null;return {delta,median,anomaly:Math.abs(delta)>=15||(sorted.length>=3&&current>median*1.3),reason:Math.abs(delta)>=15?'change':sorted.length>=3&&current>median*1.3?'market':null};}
function openDatabase(filename=process.env.SMARTPRICE_DB||path.join(process.cwd(),'data','smartprice.sqlite')){
 if(filename!==':memory:')fs.mkdirSync(path.dirname(filename),{recursive:true});
 const db=new DatabaseSync(filename);db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 db.exec(`CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,name TEXT NOT NULL,name_kk TEXT NOT NULL,name_en TEXT NOT NULL,category TEXT NOT NULL,brand TEXT NOT NULL,manufacturer TEXT NOT NULL,quantity REAL NOT NULL CHECK(quantity>0),unit TEXT NOT NULL CHECK(unit IN ('kg','l','pcs')),packaging TEXT NOT NULL,barcode TEXT,fat REAL,family TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS stores(id TEXT PRIMARY KEY,name TEXT NOT NULL,type TEXT NOT NULL,region TEXT NOT NULL,city TEXT NOT NULL,address TEXT,lat REAL,lng REAL,monitoring INTEGER NOT NULL DEFAULT 1,is_demo INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS prices(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),store_id TEXT NOT NULL REFERENCES stores(id),amount REAL NOT NULL CHECK(amount>0 AND amount<=10000000),collected_at TEXT NOT NULL,source TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'verified',reason TEXT,author_id TEXT NOT NULL REFERENCES users(id),is_demo INTEGER NOT NULL DEFAULT 1,UNIQUE(product_id,store_id,collected_at));
 CREATE INDEX IF NOT EXISTS prices_lookup ON prices(product_id,store_id,collected_at);
 CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,price_id TEXT NOT NULL REFERENCES prices(id),author_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,price_id TEXT NOT NULL REFERENCES prices(id),author_id TEXT NOT NULL REFERENCES users(id),mime TEXT NOT NULL,bytes BLOB NOT NULL,comment TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,entity TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,author_id TEXT NOT NULL,details TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS matches(id TEXT PRIMARY KEY,left_id TEXT REFERENCES products(id),right_id TEXT REFERENCES products(id),score REAL NOT NULL,status TEXT NOT NULL DEFAULT 'pending',reviewer_id TEXT REFERENCES users(id));
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
 return db;
}
function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}
function audit(db,user,entity,id,action,details={}){db.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?)').run(randomUUID(),entity,id,action,user.id,JSON.stringify(details),new Date().toISOString());}
function seed(db){if(db.prepare('SELECT count(*) AS n FROM products').get().n)return;
transaction(db,()=>{
 for(const u of [['monitor','Айдана С.','monitor'],['analyst','Данияр К.','analyst'],['manager','Алия М.','manager']])db.prepare('INSERT INTO users VALUES(?,?,?)').run(...u);
 const catalog=[
 ['milk','Молоко 2,5%','Сүт 2,5%','Milk 2.5%','dairy',1,'l',450,'milk',2.5],['milk900','Молоко 2,5%','Сүт 2,5%','Milk 2.5%','dairy',0.9,'l',420,'milk',2.5],
 ['kefir','Кефир 2,5%','Айран 2,5%','Kefir 2.5%','dairy',1,'l',490,'kefir',2.5],['cream','Сметана 20%','Қаймақ 20%','Sour cream 20%','dairy',0.2,'kg',540,'cream',20],
 ['flour','Мука пшеничная','Бидай ұны','Wheat flour','grocery',2,'kg',630,'flour',null],['sugar','Сахар','Қант','Sugar','grocery',1,'kg',430,'sugar',null],
 ['rice','Рис','Күріш','Rice','grocery',1,'kg',580,'rice',null],['buckwheat','Гречка','Қарақұмық','Buckwheat','grocery',0.8,'kg',460,'buckwheat',null],
 ['oil','Подсолнечное масло','Күнбағыс майы','Sunflower oil','grocery',1,'l',850,'oil',null],['potato','Картофель','Картоп','Potato','vegetables',1,'kg',230,'potato',null],
 ['carrot','Морковь','Сәбіз','Carrot','vegetables',1,'kg',210,'carrot',null],['onion','Лук репчатый','Пияз','Onion','vegetables',1,'kg',170,'onion',null],
 ['cabbage','Капуста','Қырыққабат','Cabbage','vegetables',1,'kg',190,'cabbage',null],['eggs','Яйца С1','Жұмыртқа С1','Eggs C1','other',10,'pcs',650,'eggs',null],
 ['bread','Хлеб пшеничный','Бидай наны','Wheat bread','other',0.5,'kg',180,'bread',null],['salt','Соль','Тұз','Salt','other',1,'kg',120,'salt',null]
 ];
 for(const [id,ru,kk,en,category,quantity,unit,base,family,fat] of catalog)db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,ru,kk,en,category,'DEMO','DEMO Kazakhstan',quantity,unit,category==='vegetables'?'loose':'pack',null,fat,family);
 for(const [i,r] of regions.entries())db.prepare('INSERT INTO stores VALUES(?,?,?,?,?,?,?,?,?,?)').run('store-'+i,'DEMO · '+r.city,i%3===0?'market':i%3===1?'supermarket':'store',r.id,r.city,null,null,null,1,1);
 const today=new Date();today.setUTCHours(9,0,0,0);
 for(let day=0;day<28;day++)for(let si=0;si<regions.length;si++)for(let pi=0;pi<catalog.length;pi++){
 const p=catalog[pi],date=new Date(today);date.setUTCDate(date.getUTCDate()-27+day);
 let price=Math.round(p[7]*(1+(si-8)*0.008+Math.sin(day*.27+pi)*.025+day*(pi%3===0?.002:-.0005)));
 if(day===26&&si===0&&p[0]==='oil')price=850; if(day===27&&si===0&&p[0]==='oil')price=1100;
 if(day===27&&si===1&&p[0]==='sugar')price=570;
 db.prepare('INSERT INTO prices VALUES(?,?,?,?,?,?,?,?,?,?)').run(`seed-${day}-${si}-${pi}`,p[0],'store-'+si,price,date.toISOString(),'demo',day===27&&((si===0&&p[0]==='oil')||(si===1&&p[0]==='sugar'))?'pending':'verified',day===27&&si===0&&p[0]==='oil'?'change':null,'monitor',1);
 }
 db.prepare('INSERT INTO matches VALUES(?,?,?,?,?,?)').run('milk-match','milk','milk900',94,'pending',null);
 db.prepare('INSERT INTO settings VALUES(?,?)').run('seeded_at',new Date().toISOString());
});}
function getUser(db,token){assert(token,'unauthorized',401);const user=db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?').get(hash(token),new Date().toISOString());assert(user,'unauthorized',401);return user;}
function hash(v){return createHash('sha256').update(v).digest('hex');}
function login(db,id){const user=db.prepare('SELECT * FROM users WHERE id=?').get(id);assert(user,'unauthorized',401);const token=randomUUID()+randomUUID();db.prepare('DELETE FROM sessions WHERE expires<?').run(new Date().toISOString());db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token),id,new Date(Date.now()+86400000).toISOString());return {user,token};}
function permit(user,roles){assert(roles.includes(user.role),'forbidden',403);}
function rows(db,sql,...args){return db.prepare(sql).all(...args);}
function priceRows(db){return rows(db,`SELECT p.*,s.name store_name,s.region,s.city,pr.quantity,pr.unit,pr.name,pr.name_kk,pr.name_en,pr.category,pr.family,pr.brand,pr.fat,
 (SELECT p2.amount FROM prices p2 WHERE p2.product_id=p.product_id AND p2.store_id=p.store_id AND p2.collected_at<p.collected_at AND p2.status!='rejected' ORDER BY p2.collected_at DESC LIMIT 1) previous,
 u.name author,(SELECT count(*) FROM evidence e WHERE e.price_id=p.id) evidence_count
 FROM prices p JOIN products pr ON pr.id=p.product_id JOIN stores s ON s.id=p.store_id JOIN users u ON u.id=p.author_id ORDER BY p.collected_at DESC,p.id DESC`).map(p=>({...p,delta:change(p.amount,p.previous),normalized:normalize(p.amount,p)}));}
function snapshot(db,user){refreshMatches(db);return {user,products:rows(db,'SELECT * FROM products'),stores:rows(db,'SELECT s.*,(SELECT max(collected_at) FROM prices WHERE store_id=s.id) last_check FROM stores s'),prices:priceRows(db),regions,users:rows(db,'SELECT * FROM users'),audit:rows(db,'SELECT a.*,u.name author FROM audit a LEFT JOIN users u ON u.id=a.author_id ORDER BY a.created_at DESC LIMIT 500'),matches:rows(db,'SELECT * FROM matches'),seeded_at:db.prepare('SELECT value FROM settings WHERE key=?').get('seeded_at').value};}
function validatePrice(db,b){const product_id=text(b.product_id),store_id=text(b.store_id);assert(db.prepare('SELECT 1 FROM products WHERE id=?').get(product_id),'product_missing');assert(db.prepare('SELECT 1 FROM stores WHERE id=? AND monitoring=1').get(store_id),'store_missing');const amount=Number(b.amount);assert(Number.isFinite(amount)&&amount>0&&amount<=10000000,'invalid_price');const date=new Date(b.collected_at);assert(Number.isFinite(date.getTime())&&date.getTime()<=Date.now()+60000,'invalid_date');return {product_id,store_id,amount,collected_at:date.toISOString(),source:text(b.source||'manual',80)};}
function addPrice(db,user,body){permit(user,['monitor']);const b=validatePrice(db,body);const dup=db.prepare('SELECT id FROM prices WHERE product_id=? AND store_id=? AND collected_at=?').get(b.product_id,b.store_id,b.collected_at);assert(!dup,'duplicate',409);const prev=db.prepare("SELECT amount FROM prices WHERE product_id=? AND store_id=? AND collected_at<? AND status!='rejected' ORDER BY collected_at DESC LIMIT 1").get(b.product_id,b.store_id,b.collected_at);const market=rows(db,`SELECT p.amount FROM prices p WHERE product_id=? AND store_id!=? AND collected_at<=? AND NOT EXISTS(SELECT 1 FROM prices q WHERE q.product_id=p.product_id AND q.store_id=p.store_id AND q.collected_at<=? AND q.collected_at>p.collected_at)`,b.product_id,b.store_id,b.collected_at,b.collected_at).map(x=>x.amount);
const analysis=analyze(b.amount,prev?.amount,market),id=randomUUID();db.prepare('INSERT INTO prices VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,b.product_id,b.store_id,b.amount,b.collected_at,b.source,analysis.anomaly?'pending':'unreviewed',analysis.reason,user.id,1);audit(db,user,'price',id,'create',{...b,analysis});recalculate(db,b.product_id,b.store_id);return {id,...analysis};}
function recalculate(db,product,store){const list=rows(db,'SELECT * FROM prices WHERE product_id=? AND store_id=? ORDER BY collected_at',product,store);for(let i=0;i<list.length;i++){const p=list[i];if(p.status==='verified'||p.status==='rejected')continue;const a=analyze(p.amount,list[i-1]?.amount);db.prepare('UPDATE prices SET status=?,reason=? WHERE id=?').run(a.anomaly||p.reason==='market'?'pending':'unreviewed',a.reason|| (p.reason==='market'?'market':null),p.id);}}
function mutate(db,user,kind,b){return transaction(db,()=>{
 if(kind==='prices')return addPrice(db,user,b);
 if(kind==='import'){permit(user,['monitor']);assert(Array.isArray(b.rows)&&b.rows.length>0&&b.rows.length<=1000,'invalid_import');return {items:b.rows.map((row,i)=>{try{return addPrice(db,user,row);}catch(e){throw new AppError(`${e.message}|${i+2}`,e.status);}})};}
 if(kind==='price-edit'){permit(user,['monitor']);const old=db.prepare('SELECT * FROM prices WHERE id=?').get(b.id);assert(old,'not_found',404);assert(old.author_id===user.id&&old.status!=='verified','locked',403);const amount=Number(b.amount);assert(Number.isFinite(amount)&&amount>0&&amount<=10000000,'invalid_price');db.prepare('UPDATE prices SET amount=?,status=?,reason=NULL WHERE id=?').run(amount,'unreviewed',b.id);recalculate(db,old.product_id,old.store_id);audit(db,user,'price',b.id,'edit',{old:old.amount,amount});return {id:b.id};}
 if(kind==='review'){permit(user,['analyst']);assert(['verified','rejected','pending'].includes(b.status));assert(db.prepare('SELECT 1 FROM prices WHERE id=?').get(b.id),'not_found',404);const comment=text(b.comment,4000);db.prepare('UPDATE prices SET status=? WHERE id=?').run(b.status,b.id);db.prepare('INSERT INTO comments VALUES(?,?,?,?,?)').run(randomUUID(),b.id,user.id,comment,new Date().toISOString());audit(db,user,'price',b.id,b.status,{comment});return {id:b.id};}
 if(kind==='comment'){permit(user,['monitor','analyst']);assert(db.prepare('SELECT 1 FROM prices WHERE id=?').get(b.id),'not_found',404);const comment=text(b.comment,4000);db.prepare('INSERT INTO comments VALUES(?,?,?,?,?)').run(randomUUID(),b.id,user.id,comment,new Date().toISOString());if(b.escalate)db.prepare('UPDATE prices SET status=? WHERE id=?').run('pending',b.id);audit(db,user,'price',b.id,b.escalate?'escalate':'comment',{comment});return {id:b.id};}
 if(kind==='stores'){permit(user,['monitor']);if(b.delete){assert(!db.prepare('SELECT 1 FROM prices WHERE store_id=? LIMIT 1').get(b.id),'store_in_use',409);assert(db.prepare('DELETE FROM stores WHERE id=?').run(b.id).changes,'not_found',404);audit(db,user,'store',b.id,'delete');return {id:b.id};}
 const id=b.id||randomUUID();assert(regions.some(r=>r.id===b.region),'invalid_region');assert(['supermarket','store','market'].includes(b.type));const lat=b.lat===''||b.lat==null?null:Number(b.lat),lng=b.lng===''||b.lng==null?null:Number(b.lng);assert((lat===null&&lng===null)||(Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=40&&lat<=56&&lng>=46&&lng<=88),'invalid_coordinates');const values=[text(b.name),b.type,b.region,text(b.city),b.address?text(b.address,500):null,lat,lng,b.monitoring?1:0];if(b.id){assert(db.prepare('UPDATE stores SET name=?,type=?,region=?,city=?,address=?,lat=?,lng=?,monitoring=? WHERE id=?').run(...values,id).changes,'not_found',404);}else db.prepare('INSERT INTO stores VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,...values,1);audit(db,user,'store',id,b.id?'edit':'create',{...b});return {id};}
 if(kind==='products'){permit(user,['monitor']);const id=b.id||randomUUID();if(b.delete){assert(!db.prepare('SELECT 1 FROM prices WHERE product_id=?').get(id),'product_in_use',409);db.prepare('DELETE FROM matches WHERE left_id=? OR right_id=?').run(id,id);assert(db.prepare('DELETE FROM products WHERE id=?').run(id).changes,'not_found',404);audit(db,user,'product',id,'delete');return {id};}assert(['dairy','grocery','vegetables','other'].includes(b.category));assert(['kg','l','pcs'].includes(b.unit));const quantity=Number(b.quantity);assert(Number.isFinite(quantity)&&quantity>0);assert(!b.barcode||/^\d{8,14}$/.test(b.barcode),'invalid_barcode');const fat=b.fat===''||b.fat==null?null:Number(b.fat);assert(fat===null||(Number.isFinite(fat)&&fat>=0&&fat<=100));if(b.id)assert(!db.prepare('SELECT 1 FROM prices WHERE product_id=?').get(id),'product_in_use',409);const vals=[text(b.name),text(b.name_kk),text(b.name_en),b.category,text(b.brand),text(b.manufacturer),quantity,b.unit,text(b.packaging),b.barcode||null,fat,text(b.family)];if(b.id)assert(db.prepare('UPDATE products SET name=?,name_kk=?,name_en=?,category=?,brand=?,manufacturer=?,quantity=?,unit=?,packaging=?,barcode=?,fat=?,family=? WHERE id=?').run(...vals,id).changes,'not_found',404);else db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,...vals);audit(db,user,'product',id,b.id?'edit':'create');return {id};}
 if(kind==='match'){permit(user,['analyst']);assert(['confirmed','rejected'].includes(b.status));assert(db.prepare('UPDATE matches SET status=?,reviewer_id=? WHERE id=?').run(b.status,user.id,b.id).changes,'not_found',404);audit(db,user,'match',b.id,b.status);return {id:b.id};}
 if(kind==='evidence'){permit(user,['monitor']);assert(db.prepare('SELECT 1 FROM prices WHERE id=?').get(b.id),'not_found',404);assert(['image/jpeg','image/png','image/webp'].includes(b.mime),'invalid_image');assert(typeof b.base64==='string'&&b.base64.length<=7000000,'invalid_image');const bytes=Buffer.from(b.base64,'base64');assert(bytes.length>12&&bytes.length<=5*1024*1024,'invalid_image');const valid=b.mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:b.mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';assert(valid,'invalid_image');const id=randomUUID();db.prepare('INSERT INTO evidence VALUES(?,?,?,?,?,?,?)').run(id,b.id,user.id,b.mime,bytes,typeof b.comment==='string'?b.comment.slice(0,4000):'',new Date().toISOString());audit(db,user,'price',b.id,'evidence',{id});return {id};}
 throw new AppError('not_found',404);
});}
function detail(db,id){assert(db.prepare('SELECT 1 FROM prices WHERE id=?').get(id),'not_found',404);return {comments:rows(db,'SELECT c.*,u.name author FROM comments c JOIN users u ON u.id=c.author_id WHERE price_id=? ORDER BY created_at',id),evidence:rows(db,'SELECT e.id,e.comment,e.created_at,u.name author FROM evidence e JOIN users u ON u.id=e.author_id WHERE price_id=? ORDER BY created_at',id)};}
module.exports={openDatabase,seed,snapshot,mutate,detail,login,getUser,AppError,change,normalize,analyze,regions,hash};



function similarity(a,b){
 if(a.unit!==b.unit||a.family!==b.family||a.category!==b.category)return 0;
 const clean=x=>String(x||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const wordsA=new Set(clean(a.name).split(' ')),wordsB=new Set(clean(b.name).split(' '));
 const overlap=[...wordsA].filter(w=>wordsB.has(w)).length/Math.max(wordsA.size,wordsB.size,1);
 if(a.fat!==b.fat)return 0;
 return Math.round(30+overlap*20+(clean(a.brand)===clean(b.brand)?15:0)+(clean(a.manufacturer)===clean(b.manufacturer)?15:0)+(a.fat===b.fat?10:0)+(a.packaging===b.packaging?10:0));
}
function refreshMatches(db){const products=rows(db,'SELECT * FROM products ORDER BY id');for(let i=0;i<products.length;i++)for(let j=i+1;j<products.length;j++){const a=products[i],b=products[j],score=similarity(a,b);if(score<75)continue;const existing=db.prepare('SELECT id FROM matches WHERE (left_id=? AND right_id=?) OR (left_id=? AND right_id=?)').get(a.id,b.id,b.id,a.id);if(existing)db.prepare('UPDATE matches SET score=? WHERE id=?').run(score,existing.id);else db.prepare('INSERT INTO matches VALUES(?,?,?,?,?,?)').run(randomUUID(),a.id,b.id,score,'pending',null);}}
module.exports.similarity=similarity;

function parseCsv(input){
 const text=String(input).replace(/^\uFEFF/,''),rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"')quoted=false;else cell+=ch;}else if(ch==='"'){assert(cell.length===0,'invalid_import');quoted=true;}else if(ch===','){row.push(cell);cell='';}else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';assert(rows.length<=1001,'invalid_import');}else cell+=ch;}
 assert(!quoted,'invalid_import');row.push(cell);if(row.some(x=>x.trim()))rows.push(row);return rows;
}
module.exports.parseCsv=parseCsv;
