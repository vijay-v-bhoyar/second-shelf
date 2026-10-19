import type { ReactNode } from "react";
export function Mark(){return <span className="brand-mark" aria-hidden="true"><i/><i/><i/></span>;}
export function Icon({name,size=20}:{name:string;size?:number}){
  const paths:Record<string,ReactNode>={
    overview:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    inventory:<><path d="M4 4h5v16H4zM10 3h5v17h-5zM16 5l4-1 3 15-4 1z"/></>,
    display:<><path d="M3 5h18v13H3zM8 22l4-4 4 4M12 1v4"/></>,
    rules:<><path d="M6 4h15M6 12h15M6 20h15M2 3v2M2 11v2M2 19v2"/><circle cx="11" cy="4" r="2"/><circle cx="17" cy="12" r="2"/><circle cx="9" cy="20" r="2"/></>,
    review:<><path d="M3 3v18h18M7 15l5-5 4 3 5-8"/></>,
    data:<><path d="M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6zM8 12l3 3 5-6"/></>,
    arrow:<path d="M4 12h15M13 6l6 6-6 6"/>,
    check:<path d="M5 12l4 4L20 5"/>,
    search:<><circle cx="10" cy="10" r="6"/><path d="M15 15l6 6"/></>,
    external:<><path d="M14 3h7v7M21 3l-10 10M10 3H3v18h18v-7"/></>,
    refresh:<><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 7a8 8 0 0113-2l2 3M19 17a8 8 0 01-13 2l-2-3"/></>,
    download:<><path d="M12 3v12M7 10l5 5 5-5M4 17v4h16v-4"/></>,
    close:<path d="M6 6l12 12M18 6L6 18"/>,
    spark:<><path d="M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3zM21 2v4M19 4h4"/></>,
    location:<><path d="M18 10c0 5-6 11-6 11S6 15 6 10a6 6 0 1112 0z"/><circle cx="12" cy="9" r="2"/></>
  };return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]??paths.overview}</svg>;
}
export function Cover({title,author,color,small=false}:{title:string;author:string;color:string;small?:boolean}){
  const channels=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  const luminance=.2126*channels[0]+.7152*channels[1]+.0722*channels[2];
  return <div className={`book-cover ${small?"small":""}`} style={{background:color,color:luminance>.18?"#000000":"#ffffff"}} aria-hidden="true"><div className="cover-line"/><span className="cover-title">{title}</span><span className="cover-art">✦</span><span className="cover-author">{author}</span><div className="cover-bottom"/></div>;
}
export function Badge({children,tone=""}:{children:ReactNode;tone?:string}){return <span className={`badge ${tone}`}>{children}</span>;}
export const money=(minor:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(minor/100);
export const timestamp=(s:string)=>new Date(s).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
