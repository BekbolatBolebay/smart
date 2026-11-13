import { NextRequest, NextResponse } from 'next/server';
import * as engine from '@/lib/smartprice/engine.cjs';
import ExcelJS from 'exceljs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
let db: any;
function database(){if(!db){db=engine.openDatabase();engine.seed(db);}return db;}
function failure(e:any){console.error('[smartprice]',e.message);return NextResponse.json({error:e.status?e.message:'server_error'},{status:e.status||500});}
function checkOrigin(req:NextRequest){const origin=req.headers.get('origin');if(origin&&new URL(origin).host!==req.headers.get('host'))throw new engine.AppError('forbidden',403);}
export async function GET(req:NextRequest,{params}:{params:{path:string[]}}){try{
 const db=database(),user=engine.getUser(db,req.cookies.get('sp_session')?.value),[kind,id]=params.path;
 if(kind==='data')return NextResponse.json(engine.snapshot(db,user),{headers:{'Cache-Control':'no-store'}});
 if(kind==='detail')return NextResponse.json(engine.detail(db,id));
 if(kind==='evidence'){const e=db.prepare('SELECT * FROM evidence WHERE id=?').get(id);if(!e)throw new engine.AppError('not_found',404);return new NextResponse(e.bytes,{headers:{'Content-Type':e.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"}});}
 if(kind==='export'){
 const lang=req.nextUrl.searchParams.get('lang')||'ru';const labels=lang==='en'?['Product','Store','Region','Package price KZT','Previous KZT','Change %','Unit price KZT','Unit','Collected at','Source','Status']:lang==='kk'?['Тауар','Сауда нүктесі','Өңір','Баға KZT','Алдыңғы KZT','Өзгеріс %','Бірлік бағасы KZT','Өлшем','Жиналған күні','Дереккөз','Мәртебе']:['Товар','Торговая точка','Регион','Цена KZT','Предыдущая KZT','Изменение %','Цена за единицу KZT','Единица','Дата сбора','Источник','Статус'];
 let prices=engine.snapshot(db,user).prices;const param=(s:string)=>req.nextUrl.searchParams.get(s);prices=prices.filter(p=>(!param('region')||p.region===param('region'))&&(!param('product')||p.product_id===param('product'))&&(!param('store')||p.store_id===param('store'))&&(!param('from')||p.collected_at>=param('from'))&&(!param('to')||p.collected_at.slice(0,10)<=param('to')));
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('SMART PRICE DEMO');sheet.addRow(['SMART PRICE — DEMO / Тестовые данные']);sheet.addRow(labels);sheet.getRow(2).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(2).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF142C4C'}};
 for(const p of prices)sheet.addRow([lang==='en'?p.name_en:lang==='kk'?p.name_kk:p.name,p.store_name,p.region,p.amount,p.previous,p.delta,p.normalized,p.unit,p.collected_at,p.source,p.status]);sheet.columns.forEach(c=>{c.width=25;});sheet.views=[{state:'frozen',ySplit:2}];
 const buffer=await workbook.xlsx.writeBuffer();return new NextResponse(buffer as any,{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="smart-price-demo.xlsx"'}});
 }
 throw new engine.AppError('not_found',404);
}catch(e){return failure(e);}}
export async function POST(req:NextRequest,{params}:{params:{path:string[]}}){try{
 checkOrigin(req);if(Number(req.headers.get('content-length'))>7500000)throw new engine.AppError('too_large',413);const db=database(),kind=params.path[0];
 if(kind==='login'){if(process.env.SMARTPRICE_DEMO_LOGIN==='false')throw new engine.AppError('demo_disabled',403);const body=await req.json(),{user,token}=engine.login(db,body.user_id);const res=NextResponse.json({user});res.cookies.set('sp_session',token,{httpOnly:true,sameSite:'strict',secure:req.nextUrl.protocol==='https:'||req.headers.get('x-forwarded-proto')==='https',path:'/',maxAge:86400});return res;}
 const user=engine.getUser(db,req.cookies.get('sp_session')?.value);
 if(kind==='logout'){db.prepare('DELETE FROM sessions WHERE token=?').run(engine.hash(req.cookies.get('sp_session').value));const res=NextResponse.json({ok:true});res.cookies.delete('sp_session');return res;}
 if(kind==='import-file'){
 if(user.role!=='monitor')throw new engine.AppError('forbidden',403);const form=await req.formData(),file=form.get('file') as File;if(!file||file.size>5*1024*1024)throw new engine.AppError('too_large',413);
 const workbook=new ExcelJS.Workbook();let sheet:any;if(file.name.toLowerCase().endsWith('.xlsx')){await workbook.xlsx.load(await file.arrayBuffer());sheet=workbook.worksheets[0];}else if(file.name.toLowerCase().endsWith('.csv')){sheet=workbook.addWorksheet('Import');engine.parseCsv(await file.text()).forEach(row=>sheet.addRow(row));}else throw new engine.AppError('invalid_import');
 if(!sheet||sheet.rowCount>1001)throw new engine.AppError('invalid_import');const headers=['product_id','store_id','amount','collected_at','source'];const actual=sheet.getRow(1).values.slice(1).map(String);if(!headers.every((h,i)=>actual[i]?.trim()===h))throw new engine.AppError('import_headers');const rows=[];sheet.eachRow((row:any,i:number)=>{if(i===1)return;const r:any={};headers.forEach((h,j)=>{const v=row.getCell(j+1).value;r[h]=v instanceof Date?v.toISOString():v;});rows.push(r);});return NextResponse.json(engine.mutate(db,user,'import',{rows}));
 }
 return NextResponse.json(engine.mutate(db,user,kind,await req.json()));
}catch(e){return failure(e);}}


