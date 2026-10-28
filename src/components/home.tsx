"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/client";
import { Cover, Icon, Mark } from "@/components/ui";
import Studio from "./studio";
export default function Home({providerMode}:{providerMode:string}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[entered,setEntered]=useState(false);
  const bootstrapKey=useRef<string|undefined>(undefined),starting=useRef(false);
  function enter(){window.history.replaceState(null,"","/studio");setEntered(true);}
  async function start(){
    if(starting.current)return;
    starting.current=true;setBusy(true);setError("");
    try{
      let pending:string|null=null;
      try{pending=sessionStorage.getItem("second-shelf-pending-bootstrap");}catch{/* Current-page retries still retain their key. */}
      bootstrapKey.current??=pending??crypto.randomUUID();
      try{sessionStorage.setItem("second-shelf-pending-bootstrap",bootstrapKey.current);}catch{/* Storage may be disabled by explicit browser preferences. */}
      await api("demo-sessions",{},"POST",false,{timeoutMs:8000,idempotencyKey:bootstrapKey.current});
      try{sessionStorage.removeItem("second-shelf-pending-bootstrap");}catch{/* No persistent key was required. */}
      enter();
    }catch(e){setError((e as Error).message);setBusy(false);}
    finally{starting.current=false;}
  }
  if(entered)return <Studio/>;
  return <div className="landing"><header className="landing-header"><a className="brand" href="/"><Mark/>Second Shelf<span className="brand-dot">.</span></a><button onClick={enter} className="text-link">Return to your bookstore <Icon name="arrow" size={16}/></button></header>
    <main id="main-content" tabIndex={-1} className="landing-main"><div className="hero-copy"><div className="eyebrow"><span className="dot"/> FOR INDEPENDENT BOOKSTORES</div><h1>A new audience.<br/>For the books<br/><em>already here.</em></h1><p>Turn the films and music people love into books they might never have picked up. Then learn what works on your shelves.</p><button className="button primary large" onClick={start} disabled={busy}>{busy?"Opening your bookstore…":error?"Retry opening demo":"Try a bookstore demo"}<Icon name="arrow"/></button>{error&&<div className="notice error"><p role="alert">{error}</p><p>Retry resumes this attempt. You can instead create separate sample data.</p><button className="button ghost" onClick={()=>{bootstrapKey.current=undefined;try{sessionStorage.removeItem("second-shelf-pending-bootstrap");}catch{/* Use the new in-memory request key. */}void start();}} disabled={busy}>Start a separate demo</button></div>}<div className="hero-note">Your own sample bookstore. No sign-up required.<br/>{providerMode==="fixture"?"Illustrative recommendations and simulated outcomes are clearly labeled.":providerMode==="live"?"Qloo access is enabled; inventory and outcomes remain sample data.":"Discovery is unavailable until Qloo access is restored. Administration remains available."}</div></div>
      <div className="hero-art" aria-label="An illustrated selection of books"><div className="art-orbit"/><div className="hero-book back"><Cover title="Sea of Tranquility" author="Emily St. John Mandel" color="#345569"/></div><div className="hero-book front"><Cover title="Piranesi" author="Susanna Clarke" color="#315851"/></div><div className="art-note"><Icon name="spark"/><div><span>FROM WHAT THEY LOVE</span><strong>A film. A song.<br/>An unexpected next read.</strong></div></div><span className="art-label">NOT ANOTHER BESTSELLER LIST.</span></div>
    </main><section className="landing-steps" aria-label="How Second Shelf works"><div><span>01</span><h2>Start with your shelves</h2><p>Bring in inventory. Confirm editions, stock, and your own bookseller judgment.</p></div><div><span>02</span><h2>Make a cultural connection</h2><p>Build a display and a discovery page around what your readers already love.</p></div><div><span>03</span><h2>Keep what works</h2><p>Record outcomes. Review the week. Make the next decision with evidence.</p></div></section><section className="landing-steps" aria-label="Before you start"><div><h2>Evaluate before adopting</h2><p>For booksellers who can review editions and maintain stock. This is not a POS system or an automated sales promise. A staff-curated shelf display is a valid alternative.</p></div><div><h2>Keep the demo safe</h2><p>Use synthetic inventory and receipt references. Your sample bookstore expires after 24 hours. Real merchant sign-in and account recovery are not established.</p></div><div><h2>Leave with control</h2><p>Export your records or delete the demo in Data &amp; privacy. Staff access is granted separately; no shopper account is required.</p></div></section><footer className="landing-footer"><span>Second Shelf · A working sample-store demo</span><span>Built around human bookseller judgment.</span></footer></div>;
}
