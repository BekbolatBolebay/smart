'use client';
import {useEffect,useRef,useState} from 'react';
import type * as Leaflet from 'leaflet';
import {Lang,tr,regionName} from '@/lib/smartprice/i18n';
import 'leaflet/dist/leaflet.css';
export default function KazakhstanMap({regions,stores,prices,selected,onSelect,lang,compact=false}:any){
 const el=useRef<HTMLDivElement>(null),map=useRef<Leaflet.Map>(),layer=useRef<Leaflet.LayerGroup>();const [failed,setFailed]=useState(false);
 useEffect(()=>{let cancelled=false;(async()=>{const L=await import('leaflet');if(cancelled||!el.current)return;const m=L.map(el.current,{scrollWheelZoom:!compact,zoomControl:!compact,attributionControl:true}).setView([48.1,67.1],compact?4:5);map.current=m;if(compact)m.fitBounds([[40.4,46.4],[55.5,87.4]],{padding:[8,8]});L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{attribution:'&copy; OpenStreetMap &copy; CARTO',maxZoom:18}).on('tileerror',()=>setFailed(true)).addTo(m);layer.current=L.layerGroup().addTo(m);try{const geo=await fetch('/smartprice/kazakhstan.geojson').then(r=>r.json());if(!cancelled)L.geoJSON(geo,{style:{color:'#819db8',weight:1.5,fillColor:'#c8dae5',fillOpacity:.25},interactive:false}).addTo(m);}catch{};m.invalidateSize();draw(L);})();return ()=>{cancelled=true;map.current?.remove();map.current=undefined;};},[]);
 function draw(L:typeof Leaflet){if(!layer.current||!map.current)return;layer.current.clearLayers();for(const r of regions){const pp=prices.filter((p:any)=>p.region===r.id);const delta=pp.length?pp.reduce((s:number,p:any)=>s+p.delta,0)/pp.length:0;const color=pp.some((p:any)=>p.status==='pending')?'#e69938':delta>1?'#df6c67':delta<0?'#209b85':'#477599';const marker=L.circleMarker([r.lat,r.lng],{radius:compact?5:selected===r.id?12:8,color:'#fff',weight:2,fillColor:color,fillOpacity:1}).addTo(layer.current);const tip=document.createElement('div');tip.textContent=regionName(r,lang)+' · '+pp.length+' '+tr('rows',lang);marker.bindTooltip(tip);marker.on('click',()=>onSelect(r.id));}
 for(const s of stores.filter((s:any)=>s.lat!=null&&s.lng!=null)){const marker=L.circleMarker([s.lat,s.lng],{radius:6,color:'#173d62',weight:2,fillColor:'#fff',fillOpacity:1}).addTo(layer.current);const box=document.createElement('div');const name=document.createElement('strong');name.textContent=s.name;box.appendChild(name);const desc=document.createElement('div');desc.textContent=s.address||tr('unknownAddress',lang);box.appendChild(desc);marker.bindPopup(box);}
 }
 useEffect(()=>{import('leaflet').then(draw);if(map.current&&!compact){const r=regions.find((r:any)=>r.id===selected);map.current.setView(r?[r.lat,r.lng]:[48.1,67.1],r?7:5);}},[selected,lang,prices,stores]);
 return <div className={'sp-map '+(compact?'compact':'')}><div ref={el} style={{height:'100%',width:'100%'}}/>{failed&&<small className="map-failed">{tr('mapUnavailable',lang)}</small>}</div>;
}

