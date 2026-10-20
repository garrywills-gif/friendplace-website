'use client';

import { usePathname } from 'next/navigation';
import { brandAssets } from '@/lib/brand-assets';

export default function SiteHeader() {
  const pathname = usePathname();
  if (pathname?.startsWith('/admin')) return null;
  const isActive = (href: string) => href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');

  return (
    <header className="site-header-root" style={{ position:'sticky',top:0,zIndex:50,backdropFilter:'saturate(180%) blur(12px)',WebkitBackdropFilter:'saturate(180%) blur(12px)',background:'rgba(254, 252, 248, 0.92)',borderBottom:'1px solid #E5E9EF',boxShadow:'0 1px 4px rgba(15, 23, 42, 0.04)' }}>
      <div className="container" style={{display:'flex',alignItems:'center',justifyContent:'space-between',minHeight:80,gap:24,paddingTop:12,paddingBottom:12}}>
        <a href="/" style={{display:'flex',alignItems:'center',gap:10,textDecoration:'none',flexShrink:0,whiteSpace:'nowrap'}}><img id="fp-brand-butterfly" src={brandAssets.butterfly.src} alt={brandAssets.butterfly.alt} width={brandAssets.butterfly.width} height={brandAssets.butterfly.height} style={{width:40,height:'auto',display:'block'}}/><span style={{fontWeight:900,fontSize:26,color:'#0A2540',letterSpacing:'-.02em'}}>Friend<span style={{color:'#14B8A6'}}>Place</span></span></a>
        <nav className="nav-desktop" style={{display:'flex',alignItems:'center'}}>{NAV.map((n,i)=><a key={n.href} href={n.href} className={`nav-link ${isActive(n.href)?'nav-link-active':''}`} data-first={i===0?'true':undefined}>{n.label}</a>)}</nav>
        {/* Native disclosure and ordinary links remain usable before hydration. */}
        <details className="nav-mobile-menu">
          <summary className="nav-mobile-toggle" aria-label="Open or close navigation menu" aria-controls="site-mobile-navigation">
            <span aria-hidden="true" className="nav-menu-line" />
            <span aria-hidden="true" className="nav-menu-line" />
            <span aria-hidden="true" className="nav-menu-line" />
          </summary>
          <nav id="site-mobile-navigation" className="nav-mobile-panel" aria-label="Mobile navigation">
            {NAV.map(n => <a key={n.href} href={n.href} aria-current={isActive(n.href) ? 'page' : undefined} style={{display:'block',padding:'14px 0 14px 12px',fontWeight:600,color:isActive(n.href)?'#0F766E':'#0A2540',borderBottom:'1px solid #E5E9EF',borderLeft:isActive(n.href)?'3px solid #14B8A6':'3px solid transparent'}}>{n.label}</a>)}
            {MOBILE_EXTRAS.map(n => <a key={n.href} href={n.href} style={{display:'block',padding:'14px 0 14px 32px',fontWeight:500,fontSize:14,color:'#475569'}}>↳ {n.label}</a>)}
          </nav>
        </details>
      </div>
      <style dangerouslySetInnerHTML={{__html:`.nav-link{position:relative;color:#0A2540;font-weight:600;font-size:16px;white-space:nowrap;padding:10px 12px;border-radius:10px;text-decoration:none;cursor:pointer;transition:color 140ms ease,background 140ms ease,transform 100ms ease}.nav-link:hover{color:#0F766E;background:rgba(20,184,166,.08)}.nav-link:active{transform:translateY(1px);background:rgba(20,184,166,.14)}.nav-link:focus-visible{outline:2px solid #14B8A6;outline-offset:2px}.nav-link::before{content:'';position:absolute;left:0;top:50%;transform:translateY(-50%);width:1px;height:14px;background:rgba(20,184,166,.22);pointer-events:none}.nav-link[data-first]::before{display:none}.nav-link::after{content:'';position:absolute;left:50%;right:50%;bottom:2px;height:2px;border-radius:2px;background:rgba(20,184,166,.4);transition:left 220ms ease,right 220ms ease,background 180ms ease;pointer-events:none}.nav-link:hover::after{left:16px;right:16px}.nav-link-active{color:#0F766E!important}.nav-link-active::after{left:16px!important;right:16px!important;background:#14B8A6!important}.nav-mobile-menu{display:none}.nav-mobile-toggle{list-style:none;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;width:44px;height:44px;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:4px;border:1px solid #CBD5E1;border-radius:12px;background:#FEFCF8}.nav-mobile-toggle::-webkit-details-marker{display:none}.nav-mobile-toggle::marker{content:''}.nav-mobile-toggle:focus-visible{outline:2px solid #0F766E;outline-offset:3px}.nav-menu-line{display:block;width:20px;height:2px;background:#0A2540;pointer-events:none}.nav-mobile-menu[open] .nav-menu-line:first-child{transform:translateY(6px) rotate(45deg)}.nav-mobile-menu[open] .nav-menu-line:nth-child(2){opacity:0}.nav-mobile-menu[open] .nav-menu-line:last-child{transform:translateY(-6px) rotate(-45deg)}.nav-mobile-panel{position:absolute;top:100%;left:0;right:0;background:#FEFCF8;border-top:1px solid #E5E9EF;box-shadow:0 12px 20px rgba(15,23,42,.12);padding:12px 24px 24px;max-height:calc(100vh - 104px);max-height:calc(100dvh - 104px);overflow-y:auto;-webkit-overflow-scrolling:touch}.nav-mobile-menu:not([open]) .nav-mobile-panel{display:none}@media(max-width:1100px){.nav-desktop{display:none!important}.nav-mobile-menu{display:block;flex-shrink:0}}`}}/>
    </header>
  );
}

const NAV=[{label:'About',href:'/about'},{label:'How It Works',href:'/how-it-works'},{label:'Features',href:'/features'},{label:'Events',href:'/events'},{label:'Stories',href:'/success-stories'},{label:'Guides',href:'/guides'},{label:'FAQs',href:'/faqs'},{label:'Contact',href:'/contact'}];
const MOBILE_EXTRAS=[{label:'List an Event',href:'/list-your-event'}];
