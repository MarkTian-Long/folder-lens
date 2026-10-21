'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
// This is a logic test harness, not a browser or a rendering test. Element
// stand-ins let the shipped functions run without reading any user directory.
module.exports=function loadUI(){
  const elements=new Map(),timers=new Set(),downloads=[];
  class Element{
    constructor(key){this.key=key;this.value='';this.hidden=false;this.disabled=false;this.open=false;this.textContent='';this.innerHTML='';this.children=[];this.dataset={};this.attributes=new Map();this.firstChild={textContent:''};this.style={};this.classList={toggle(){},add(){},remove(){}};}
    querySelector(selector){return get(this.key+' '+selector);}
    querySelectorAll(){return [];}
    addEventListener(){}
    setAttribute(k,v){this.attributes.set(k,String(v));}
    getAttribute(k){return this.attributes.get(k);}
    append(...items){this.children.push(...items);}
    appendChild(item){this.children.push(item);}
    replaceChildren(...items){this.children=items;}
    focus(){} select(){} remove(){} click(){if(this.download)downloads.push({name:this.download,url:this.href});}
    showModal(){this.open=true;} close(){this.open=false;}
    closest(){return this;}
  }
  function get(key){if(!elements.has(key))elements.set(key,new Element(key));return elements.get(key);}
  const body=get('body'),blobs=[];
  const document={body,querySelector:get,querySelectorAll:()=>[],createElement:tag=>new Element(tag),createDocumentFragment:()=>new Element('fragment'),addEventListener(){}};
  const sandbox={document,window:{addEventListener(){}},navigator:{},localStorage:{getItem:()=>null,setItem(){}},console,Blob,AbortController,URL:{createObjectURL(blob){blobs.push(blob);return 'blob:test-'+blobs.length;},revokeObjectURL(){}},setTimeout(fn,ms){const timer=setTimeout(fn,ms);if(ms>=1000)timer.unref();timers.add(timer);return timer;},clearTimeout(timer){timers.delete(timer);clearTimeout(timer);},setInterval,clearInterval};
  const context=vm.createContext(sandbox);
  const html=fs.readFileSync(path.resolve(__dirname,'../../FolderLens.html'),'utf8');
  const source=html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i)[1];
  new vm.Script(source,{filename:'FolderLens.html'}).runInContext(context);
  const app=vm.runInContext('({S,Core,runScan,orderedRows,filteredRows,matchesDepth,showDepth,changeView,navigate,renderRows,candidatesAction,doExport,exportValues,discoveredFileCounts,CSV_COLUMNS})',context);
  return {...app,context,elements,blobs,downloads,cleanup(){for(const timer of timers)clearTimeout(timer);}};
};
