export function latestPrices(prices:any[]){const found=new Set();return [...prices].sort((a,b)=>b.collected_at.localeCompare(a.collected_at)).filter(p=>{const key=p.product_id+'|'+p.store_id;if(found.has(key)||p.status==='rejected')return false;found.add(key);return true;});}
export function baskets(prices:any[],products:any[]){
 const days:Record<string,any[]>={};for(const p of prices){const day=p.collected_at.slice(0,10);(days[day]||=[]).push(p);}
 const families=Array.from(new Set(products.map(p=>p.family)));let carried:any[]=[];
 return Object.entries(days).sort(([a],[b])=>a.localeCompare(b)).map(([day,ps])=>{
 carried=latestPrices([...ps,...carried]);const averages=families.map(f=>{const group=carried.filter(p=>p.family===f);return group.length?group.reduce((s,p)=>s+p.normalized,0)/group.length:null;});
 return {day,value:averages.length&&averages.every(v=>v!==null)?Math.round(averages.reduce((s,v)=>s+(v||0),0)):null};
 });
}
