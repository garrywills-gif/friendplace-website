'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { brandAssets } from '@/lib/brand-assets';

export default function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  if (pathname?.startsWith('/admin')) return null;
  const isActive = (href: string) => href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');

  return (
    <header className="site-header-root" style={{ position:'sticky',top:0,zIndex:50,backdropFilter:'saturate(180%) blur(12px)',WebkitBackdropFilter:'saturate(180%) blur(12px)',background:'rgba(254, 252, 248, 0.92)',borderBottom:'1px solid #E5E9EF',boxShadow:'0 1px 4px rgba(15, 23, 42, 0.04)',transform:'translate3d(0, 0, 0)',WebkitTransform:'translate3d(0, 0, 0)',willChange:'transform',isolation:'isolate' }}>
      <div className="container" style={{display:'flex',alignItems:'center',justifyContent:'space-between',height:72}}>
        <Link href="/" style={{display:'flex',alignItems:'center',gap:10,textDecoration:'none'}}><img id="fp-brand-butterfly" src={brandAssets.butterfly.src} alt={brandAssets.butterfly.alt} width={brandAssets.butterfly.width} height={brandAssets.butterfly.height} style={{width:40,height:'auto',display:'block'}}/><span style={{fontWeight:900,fontSize:22,color:'#0A2540',letterSpacing:'-.02em'}}>Friend<span style={{color:'#14B8A6'}}>Place</span></span></Link>
        <nav className="nav-desktop" style={{display:'flex',alignItems:'center'}}>{NAV.map((n,i)=><Link key={n.href} href={n.href} className={`nav-link ${isActive(n.href)?'nav-link-active':''}`} data-first={i===0?'true':undefined}>{n.label}</Link>)}</nav>
        <button className="nav-mobile-toggle" aria-label="Toggle menu" onClick={()=>setOpen(v=>!v)} style={{display:'none',background:'transparent',border:0,width:40,height:40,borderRadius:999}}><span style={{display:'block',width:20,height:2,background:'#0A2540',margin:'4px auto',transform:open?'translateY(6px) rotate(45deg)':'none'}}/><span style={{display:'block',width:20,height:2,background:'#0A2540',margin:'4px auto',opacity:open?0:1}}/><span style={{display:'block',width:20,height:2,background:'#0A2540',margin:'4px auto',transform:open?'translateY(-6px) rotate(-45deg)':'none'}}/></button>
      </div>
      {open&&<div className="nav-mobile-panel" style={{background:'#FEFCF8',borderTop:'1px solid #E5E9EF',padding:'16px 24px'}}>{NAV.map(n=><Link key={n.href} href={n.href} onClick={()=>setOpen(false)} style={{display:'block',padding:'12px 0 12px 12px',fontWeight:600,color:isActive(n.href)?'#14B8A6':'#0A2540',borderBottom:'1px solid #F1F5F9',borderLeft:isActive(n.href)?'3px solid #14B8A6':'3px solid transparent'}}>{n.label}</Link>)}{MOBILE_EXTRAS.map(n=><Link key={n.href} href={n.href} onClick={()=>setOpen(false)} style={{display:'block',padding:'10px 0 10px 32px',fontWeight:500,fontSize:14,color:isActive(n.href)?'#14B8A6':'#475569',borderBottom:'1px solid #F1F5F9',borderLeft:isActive(n.href)?'3px solid #14B8A6':'3px solid transparent'}}>↳ {n.label}</Link>)}</div>}
      <style dangerouslySetInnerHTML={{__html:`.nav-link{position:relative;color:#0A2540;font-weight:600;font-size:15px;padding:10px 16px;border-radius:10px;text-decoration:none;cursor:pointer;transition:color 140ms ease,background 140ms ease,transform 100ms ease}.nav-link:hover{color:#0F766E;background:rgba(20,184,166,.08)}.nav-link:active{transform:translateY(1px);background:rgba(20,184,166,.14)}.nav-link:focus-visible{outline:2px solid #14B8A6;outline-offset:2px}.nav-link::before{content:'';position:absolute;left:0;top:50%;transform:translateY(-50%);width:1px;height:14px;background:rgba(20,184,166,.22);pointer-events:none}.nav-link[data-first]::before{display:none}.nav-link::after{content:'';position:absolute;left:50%;right:50%;bottom:2px;height:2px;border-radius:2px;background:rgba(20,184,166,.4);transition:left 220ms ease,right 220ms ease,background 180ms ease;pointer-events:none}.nav-link:hover::after{left:16px;right:16px}.nav-link-active{color:#0F766E!important}.nav-link-active::after{left:16px!important;right:16px!important;background:#14B8A6!important}@media(max-width:900px){.nav-desktop{display:none!important}.nav-mobile-toggle{display:block!important}}`}}/>
    </header>
  );
}

const NAV=[{label:'About',href:'/about'},{label:'How It Works',href:'/how-it-works'},{label:'Features',href:'/features'},{label:'Events',href:'/events'},{label:'Stories',href:'/success-stories'},{label:'Guides',href:'/guides'},{label:'FAQs',href:'/faqs'},{label:'Contact',href:'/contact'}];
const MOBILE_EXTRAS=[{label:'List an Event',href:'/list-your-event'}];
