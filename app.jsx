import { useState, useEffect, useCallback, useRef, useMemo } from "react";

// ╔══════════════════════════════════════════════════════════════╗
// ║  ATÖLYE OS — ENGINE & REPOSITORY KATMANI                    ║
// ║  Tüm hesap motorları, repository'ler ve servisler burada.   ║
// ╚══════════════════════════════════════════════════════════════╝

// ── ZAMAN YARDIMCILARI ────────────────────────────────────────
// Tüm süreler: SANİYE (integer). "Dk" hiçbir yerde kullanılmaz.
const snGoster = (sn) => {
  if(!sn||sn<=0) return "—";
  const dk = Math.floor(sn/60), s = sn%60;
  return dk>0 ? `${dk}dk${s>0?" "+s+"sn":""}` : `${s}sn`;
};
const snToStr = snGoster; // alias — eski kullanımlar için

// ── BİRİM ENGINE ──────────────────────────────────────────────
// TEK kaynak: tüm birim dönüşümleri burada.
// Başka hiçbir yerde birim hesabı yapılmaz.

/**
 * boyUzunlukuDuzelt: Ham madde kayıtlarında boyUzunluk cm cinsinden.
 * Kullanıcı yanlışlıkla mt girebilir (6 yerine 600 yazacakken 6 yazar).
 * <10 ise mt sanıp ×100 yapar.
 */
const boyUzunlukCmDuzelt = (v) => {
  const n = Number(v)||0;
  if(n<=0) return 0;
  return n < 10 ? n * 100 : n; // 6 → 600, 600 → 600
};

/**
 * birimToCm: Herhangi bir uzunluk birimini cm'e çevirir.
 * boyUzunlukCm: ham maddenin 1 boy kaç cm olduğu.
 */
const uzunlukBirimiToCm = (birim, boyUzunlukCm) => {
  const map = { mm: 0.1, cm: 1, mt: 100, boy: boyUzunlukCm || 1 };
  return map[birim] ?? 1;
};

/**
 * bomMiktarToStokBirimi:
 * BOM'da girilen miktarı ham maddenin STOK birimine çevirir.
 * Örnek: BOM=25cm, stok birimi=boy, boyUzunluk=600cm → 25/600 = 0.0417 boy
 * Bu fonksiyon TEK kaynak — tedarik ve malzeme kontrol buradan beslenir.
 */
const bomMiktarToStokBirimi = (hm, bomMiktar, bomBirim) => {
  if(!hm || !bomMiktar) return 0;
  const grup = hm.birimGrup;
  if(!grup || grup==="adet") return bomMiktar;

  if(grup==="uzunluk") {
    const boyUzunlukCm = boyUzunlukCmDuzelt(hm.boyUzunluk);
    const miktarCm = bomMiktar * uzunlukBirimiToCm(bomBirim, boyUzunlukCm||1);
    // Stok birimine çevir
    if(hm.birim==="mt")  return miktarCm / 100;
    if(hm.birim==="cm")  return miktarCm;
    if(hm.birim==="mm")  return miktarCm * 10;
    if(hm.birim==="boy") {
      if(!boyUzunlukCm) return bomMiktar; // boyUzunluk girilmemiş — güvenli fallback
      return miktarCm / boyUzunlukCm;
    }
    return miktarCm / 100; // fallback: mt gibi
  }
  if(grup==="alan") {
    const toCm2 = { cm2:1, m2:10000 };
    const miktarCm2 = bomMiktar * (toCm2[bomBirim]??1);
    if(hm.birim==="m2")  return miktarCm2 / 10000;
    return miktarCm2;
  }
  if(grup==="hacim") {
    const toCm3 = { cm3:1, lt:1000, m3:1000000 };
    const miktarCm3 = bomMiktar * (toCm3[bomBirim]??1);
    if(hm.birim==="m3")  return miktarCm3 / 1000000;
    if(hm.birim==="lt")  return miktarCm3 / 1000;
    return miktarCm3;
  }
  if(grup==="agirlik") {
    const toGr = { gr:1, kg:1000 };
    const miktarGr = bomMiktar * (toGr[bomBirim]??1);
    if(hm.birim==="kg") return miktarGr / 1000;
    return miktarGr;
  }
  return bomMiktar;
};

// ── BOM ENGINE ────────────────────────────────────────────────
// TEK kaynak: tüm BOM maliyet hesapları burada.

const _netFiyat = (liste, iskonto) => (liste||0) * (1 - ((iskonto||0)/100));

/**
 * _bomKalemMaliyet: Tek bir BOM kaleminin maliyetini hesaplar (KDV dahil).
 * İç fonksiyon — dışarıdan bomKalemMaliyet kullanılır.
 */
const _bomKalemMaliyet = (kalem, bomMiktar, bomBirim, allHam=[], allYM=[], allHiz=[], depth=0, firePct=0) => {
  if(!kalem || !bomMiktar || (depth||0) > 8) return 0;
  const efektifMiktar = bomMiktar * (1 + ((firePct||0)/100));

  // YM: rekürsif BOM hesabı
  if(kalem.bom !== undefined && !kalem.listeFiyat && !kalem.birimFiyat) {
    const birimMaliyet = _ymBirimMaliyet(kalem, allHam, allYM, allHiz, depth);
    return birimMaliyet * efektifMiktar;
  }

  const listeNet = _netFiyat(kalem.listeFiyat || kalem.birimFiyat || 0, kalem.iskonto || 0);
  if(!listeNet) return 0;
  const net = listeNet * (1 + ((kalem.kdv||0)/100));

  if(kalem.birimGrup==="adet" || kalem.tip==="ic" || kalem.tip==="fason" || !kalem.birimGrup) {
    return net * efektifMiktar;
  }
  if(kalem.birimGrup==="uzunluk") {
    // KURAL: listeFiyat HER ZAMAN TL/mt cinsinden.
    // birim="boy" → sadece stok sayım birimi, fiyat hesabını ETKİLEMEZ.
    // Her durumda: miktarCm / 100 * net (TL/mt)
    const boyUzunlukCm = boyUzunlukCmDuzelt(kalem.boyUzunluk);
    const miktarCm = efektifMiktar * uzunlukBirimiToCm(bomBirim, boyUzunlukCm || 100);
    if(kalem.birim==="cm") return miktarCm * net;          // TL/cm (nadir)
    if(kalem.birim==="mm") return (miktarCm * 10) * net;   // TL/mm (çok nadir)
    // mt veya boy → her ikisi de TL/mt kullanır
    return (miktarCm / 100) * net;
  }
  if(kalem.birimGrup==="alan") {
    const toCm2 = { cm2:1, m2:10000 };
    const hamCm2 = toCm2[kalem.birim] ?? 1;
    const bomCm2 = toCm2[bomBirim] ?? 1;
    return (net / hamCm2) * efektifMiktar * bomCm2;
  }
  if(kalem.birimGrup==="hacim") {
    const toCm3 = { cm3:1, lt:1000, m3:1000000 };
    const hamCm3 = toCm3[kalem.birim] ?? 1;
    const bomCm3 = toCm3[bomBirim] ?? 1;
    return (net / hamCm3) * efektifMiktar * bomCm3;
  }
  if(kalem.birimGrup==="agirlik") {
    const toGr = { gr:1, kg:1000 };
    const hamGr = toGr[kalem.birim] ?? 1;
    const bomGr = toGr[bomBirim] ?? 1;
    return (net / hamGr) * efektifMiktar * bomGr;
  }
  return net * efektifMiktar;
};

const _ymBirimMaliyet = (ym, allHam=[], allYM=[], allHiz=[], depth=0) => {
  if(!ym || depth > 8) return 0;
  return (ym.bom||[]).reduce((s,b) => {
    const kalem = allHam.find(x=>x.id===b.kalemId) || allYM.find(x=>x.id===b.kalemId) || allHiz.find(x=>x.id===b.kalemId);
    if(!kalem) return s;
    return s + _bomKalemMaliyet(kalem, b.miktar, b.birim, allHam, allYM, allHiz, depth+1, b.fireTahmini||0);
  }, 0);
};

// ── MALZEME ENGINE ────────────────────────────────────────────
// TEK kaynak: eksik malzeme ve tedarik miktarı hesapları burada.

/**
 * bomMalzemeListesi:
 * Bir ürünün BOM'undan gereken tüm ham maddeleri listeler.
 * Stok birimine çevrilmiş miktarlar döner.
 * allYM: tüm yarimamul listesi (rekürsif YM zinciri için)
 */
/**
 * bomMalzemeListesi:
 * Bir ürünün BOM'undan gereken tüm ham maddeleri listeler.
 * 
 * KRİTİK MANTIK — YM (Yarı Mamül) stok düşürme:
 * Bir YM'nin stoğu varsa, önce stoktan karşılanır.
 * Sadece stoktan karşılanamayan kısım için alt BOM'a (ham maddelere) inilir.
 * 
 * Örnek: 1000 adet ürün, BOM'da "Trio Ham İskelet" YM, YM stoğu 500
 * → 500 adet stoktan karşılanır, sadece kalan 500 adedin ham maddesi hesaplanır.
 * → Bu sayede fazladan ham madde sipariş edilmez.
 * 
 * ymStokKullanim: rekürsif çağrılar boyunca aynı YM'den birden fazla
 * kullanılıyorsa kümülatif stok takibi yapar.
 */
/**
 * bomMalzemeListesi:
 * Bir ürünün BOM'undan gereken tüm ham maddeleri listeler.
 * YM stoğu varsa düşer, sadece üretilecek kısım için alt BOM'a iner.
 *
 * _sharedYmStok: Opsiyonel. Çoklu ürün hesaplarında (topluUEOlustur gibi)
 * YM stoğunu ürünler arasında PAYLAŞTIRMAK için dışarıdan geçirilir.
 * Tek ürünlü çağrılarda geçirilmezse yeni obje oluşturulur.
 */
const bomMalzemeListesi = (urun, adet, allHam, allYM, allUrun, _sharedYmStok) => {
  if(!urun?.bom || !adet) return [];
  const liste = [];
  const ymStokKullanim = _sharedYmStok || {};

  const hmEkle = (hm, bomMiktar, bomBirim, carpan) => {
    const stokMiktar = bomMiktarToStokBirimi(hm, bomMiktar||0, bomBirim||hm.birim);
    const gereken = stokMiktar * adet * carpan;
    const mevcut = hm.miktar||0;
    const var2 = liste.find(x=>x.id===hm.id);
    if(var2) {
      var2.gereken += gereken;
      var2.eksik = Math.max(0, var2.gereken - var2.mevcut);
      var2.yeterli = var2.eksik === 0;
    } else {
      liste.push({ id:hm.id, ad:hm.ad, birim:hm.birim, gereken, mevcut, eksik:Math.max(0,gereken-mevcut), yeterli:gereken<=mevcut });
    }
  };

  const ymIn = (ym, bomMiktar, carpan, depth) => {
    const ymBom = ym.bom || [];
    if(ymBom.length === 0) return;
    const ymGereken = Math.round((bomMiktar||1) * carpan * adet * 1e10) / 1e10;
    const ymStok = ym.miktar || 0;
    const onceki = ymStokKullanim[ym.id] || 0;
    const kalan = Math.max(0, ymStok - onceki);
    const stokK = Math.min(ymGereken, kalan);
    const uretilecek = Math.max(0, ymGereken - stokK);
    ymStokKullanim[ym.id] = onceki + stokK;
    if(uretilecek > 0) {
      topla(ymBom, Math.round((uretilecek / adet) * 1e10) / 1e10, depth+1);
    }
  };

  const topla = (bom, carpan=1, depth=0) => {
    if(depth > 8) return;
    (bom||[]).forEach(b => {
      if(b.tip==="hizmet") return;
      const hm = (allHam||[]).find(x=>x.id===b.kalemId);
      const ym = (allYM||[]).find(x=>x.id===b.kalemId);
      const ur = (allUrun||[]).find(x=>x.id===b.kalemId);

      if(hm) {
        hmEkle(hm, b.miktar, b.birim, carpan);
      } else if(ym || ur) {
        const hedef = ym || ur;
        if(hedef.bom?.length) {
          ymIn(hedef, b.miktar, carpan, depth);
        }
      }
    });
  };

  topla(urun.bom);
  return liste;
};

/**
 * eksikMalzemeleriHesapla:
 * Bir üretim emri için güncel stoka göre eksik malzemeleri hesaplar.
 * Tedarik sekmesinde ve UE modalında kullanılır.
 */
const eksikMalzemeleriHesapla = (ue, allHam, allYM, allUrun) => {
  if(!ue?.urunId) return [];
  const urun = (allUrun||[]).find(x=>x.id===ue.urunId);
  if(!urun) return [];
  const liste = bomMalzemeListesi(urun, ue.adet||1, allHam, allYM, allUrun);
  return liste
    .filter(m=>!m.yeterli)
    .map(m => ({
      ...m,
      // Eski tedarik durumunu koru
      tedarikDurum: (ue.eksikMalzemeler||[]).find(x=>x.id===m.id)?.tedarikDurum,
      siparisVerildi: (ue.eksikMalzemeler||[]).find(x=>x.id===m.id)?.siparisVerildi,
      geldiAt: (ue.eksikMalzemeler||[]).find(x=>x.id===m.id)?.geldiAt,
    }));
};


// ── STOK REZERVASYON + TOPLU UE ENGINE ───────────────────────────
const toplamRezervasyon = (sips, allU, allH, allY) => {
  const rz={},ur={};
  (sips||[]).forEach(sp=>{if(sp.durum==="tamamlandi"||sp.durum==="iptal"||sp.durum==="sevk_edildi")return;
    (sp.kalemler||[]).forEach(k=>{if(!k.urunId||!k.adet)return;ur[k.urunId]=(ur[k.urunId]||0)+(k.adet||0);
      const u=allU.find(x=>x.id===k.urunId);if(!u)return;const p2=(ur[k.urunId]||0)-(k.adet||0);
      const kl=Math.max(0,(u.stok||0)-p2);const ut=Math.max(0,(k.adet||0)-kl);
      if(ut>0)bomMalzemeListesi(u,ut,allH,allY,allU).forEach(m=>{rz[m.id]=(rz[m.id]||0)+m.gereken;});});});
  return{hammadde:rz,urun:ur};
};
const siparisKalemAnalizleri = (kalemler, mevSip, exId, allU, allH, allY) => {
  const filt=(mevSip||[]).filter(s=>s.id!==exId);const dR=toplamRezervasyon(filt,allU,allH,allY);
  const iU={},iH={};
  return kalemler.map(k=>{if(!k.urunId||!k.adet)return null;
    const u=allU.find(x=>x.id===k.urunId);if(!u)return{stokYeterli:false,stokMiktar:0,stokKarsilanan:0,uretilecek:k.adet,eksikHamMaddeler:[]};
    const kl=Math.max(0,(u.stok||0)-(dR.urun[k.urunId]||0)-(iU[k.urunId]||0));
    const sK=Math.min(k.adet,kl);const ut=Math.max(0,k.adet-sK);iU[k.urunId]=(iU[k.urunId]||0)+k.adet;
    let ek=[];if(ut>0){ek=bomMalzemeListesi(u,ut,allH,allY,allU).map(m=>{
      const kl2=Math.max(0,m.mevcut-(dR.hammadde[m.id]||0)-(iH[m.id]||0));const e2=Math.max(0,m.gereken-kl2);
      iH[m.id]=(iH[m.id]||0)+m.gereken;return{...m,kullanilabilir:kl2,eksik:e2,yeterli:e2===0};});}
    return{stokYeterli:ut===0,stokMiktar:kl,stokKarsilanan:sK,uretilecek:ut,eksikHamMaddeler:ek};});
};
const topluUEOlustur = (sp, {urunler,hamMaddeler,yarimamulList,hizmetler,uretimEmirleri,siparisler}) => {
  const kalemler=sp.kalemler||[];if(!kalemler.length)return{ueler:[],malzemeler:[]};
  
  // GÜNCEL stok analizi — kayıtlı değerler yerine anlık hesapla
  const gecerliKalemler = kalemler.filter(k=>k.urunId&&k.adet>0);
  const guncelAnalizler = siparisKalemAnalizleri(gecerliKalemler, siparisler||[], sp.id, urunler, hamMaddeler, yarimamulList);
  
  const uG={};
  gecerliKalemler.forEach((k,ki)=>{
    const a = guncelAnalizler?.[ki] || {};
    if(!k.urunId)return;
    if(!uG[k.urunId])uG[k.urunId]={urunId:k.urunId,topAdet:0,stokK:0,urtK:0,altler:[]};
    uG[k.urunId].topAdet+=(k.adet||0);
    uG[k.urunId].stokK+=(a.stokKarsilanan||0);
    uG[k.urunId].urtK+=(a.uretilecek||0);
    if(k.altMusteriAd)uG[k.urunId].altler.push({ad:k.altMusteriAd,adet:k.adet});
  });
  const mevUE=(uretimEmirleri||[]).length;const ueler=[];const tumMalz={};let idx=0;
  // KRİTİK: Paylaşımlı YM stok objesi — tüm ürünler arasında YM stoğu doğru paylaşılır
  const sharedYmStok = {};
  Object.values(uG).forEach(g=>{if(g.urtK<=0)return;const u=urunler.find(x=>x.id===g.urunId);if(!u)return;
    const hz=hizmetler||[];const asm=[];const hT=(bom,d=0)=>{if(d>6)return;(bom||[]).forEach(b=>{
      if(b.tip==="hizmet"){const h=hz.find(x=>x.id===b.kalemId);if(h&&!asm.find(a=>a.hizmetId===h.id))asm.push({id:uid(),ad:h.ad,durum:"bekliyor",calisan:h.calisan||"",sureDk:h.sureDkAdet||0,fason:h.tip==="fason",hizmetId:h.id});}
      else if(b.tip==="yarimamul"){const ym=yarimamulList.find(x=>x.id===b.kalemId)||urunler.find(x=>x.id===b.kalemId);hT(ym?.bom||[],d+1);}});};
    (u.bom||[]).forEach(b=>{if(b.tip==="yarimamul"){const ym=yarimamulList.find(x=>x.id===b.kalemId)||urunler.find(x=>x.id===b.kalemId);hT(ym?.bom||[],1);}});
    (u.bom||[]).filter(b=>b.tip==="hizmet").forEach(b=>hT([b]));
    const ml=bomMalzemeListesi(u,g.urtK,hamMaddeler,yarimamulList,urunler,sharedYmStok);
    ml.forEach(m=>{
      if(!tumMalz[m.id]) tumMalz[m.id]={...m,gereken:0,eksik:0};
      tumMalz[m.id].gereken+=m.gereken;
      // KRİTİK: eksik = toplam gereken - mevcut stok (stok sadece BİR KERE sayılır!)
      tumMalz[m.id].eksik=Math.max(0,tumMalz[m.id].gereken - tumMalz[m.id].mevcut);
      tumMalz[m.id].yeterli=tumMalz[m.id].eksik<=0;
    });
    const aS=g.altler.length>0?" ("+g.altler.map(a=>a.ad+" "+a.adet).join(", ")+")":"";
    ueler.push({id:uid(),kod:"UE-"+String(mevUE+idx+1).padStart(3,"0"),urunId:g.urunId,urunAd:u.ad,
      adet:g.urtK,durum:"bekliyor",sipNo:sp.id,termin:sp.termin||"",strateji:"gunluk",
      notlar:"Sipariş: "+sp.id+" — "+g.topAdet+" adet"+aS+(g.stokK>0?" (stoktan "+g.stokK+")":""),
      asamalar:asm,eksikMalzemeler:ml.filter(m=>!m.yeterli),olusturmaTarihi:new Date().toISOString()});idx++;});
  return{ueler,malzemeler:Object.values(tumMalz)};
};

// ── REZERVE ENGINE ────────────────────────────────────────────
// Aktif üretim emirlerinden ham madde ve yarı mamül rezervasyonlarını hesaplar.
// Fiziksel stok düşmeden önce "bu kadar malzeme ayrıldı" bilgisi verir.
const hesaplaRezervasyon = (uretimEmirleri, urunler, hamMaddeler, yarimamulList) => {
  const hmRezerve = {}; // hmId → toplam rezerve miktar
  const ymRezerve = {}; // ymId → toplam rezerve miktar
  const sharedYm = {};

  (uretimEmirleri||[])
    .filter(e => e.durum!=="tamamlandi" && e.durum!=="iptal")
    .forEach(ue => {
      const urun = urunler.find(x=>x.id===ue.urunId);
      if(!urun?.bom) return;
      const adet = ue.adet||1;

      // Ham madde rezervasyonu
      const ml = bomMalzemeListesi(urun, adet, hamMaddeler, yarimamulList, urunler, sharedYm);
      ml.forEach(m => {
        hmRezerve[m.id] = (hmRezerve[m.id]||0) + m.gereken;
      });

      // YM rezervasyonu — BOM'daki YM'leri tara
      const ymTara = (bom, carpan=1, depth=0) => {
        if(depth>8) return;
        (bom||[]).forEach(b => {
          if(b.tip==="hizmet") return;
          const ym = (yarimamulList||[]).find(x=>x.id===b.kalemId) || (urunler||[]).find(x=>x.id===b.kalemId);
          if(ym && ym.bom?.length) {
            const gereken = (b.miktar||1) * carpan * adet;
            ymRezerve[ym.id] = (ymRezerve[ym.id]||0) + gereken;
            ymTara(ym.bom, (b.miktar||1)*carpan, depth+1);
          }
        });
      };
      ymTara(urun.bom);
    });

  return { hammadde: hmRezerve, yarimamul: ymRezerve };
};

// ── TERMİN ENGINE ─────────────────────────────────────────────

const ekleIsGunuEngine = (baslangic, gun) => {
  const t = new Date(baslangic);
  let eklenen=0, guvenlik=0;
  while(eklenen<gun && guvenlik<500) {
    t.setDate(t.getDate()+1); guvenlik++;
    const g=t.getDay();
    if(g!==0&&g!==6) eklenen++;
  }
  return t;
};

const isGunuFarkiEngine = (baslangic, bitis) => {
  const a=new Date(baslangic), b=new Date(bitis);
  if(isNaN(a.getTime())||isNaN(b.getTime())||b<=a) return 0;
  let sayi=0, guvenlik=0; const t=new Date(a);
  while(t<b && guvenlik<500){ t.setDate(t.getDate()+1); guvenlik++; const g=t.getDay(); if(g!==0&&g!==6) sayi++; }
  return sayi;
};

const terminHesaplaEngine = (asamalar, adet, baslangic=new Date()) => {
  // asamalar.sureDk = saniye cinsinden (sureAdet)
  const guvAdet = Math.max(1, adet||1);
  const toplamSn = (asamalar||[]).reduce((s,a) => {
    if(a.fason) return s;
    return s + ((a.sureDk||a.sureAdet||0) * guvAdet);
  }, 0);
  const fasonGun = (asamalar||[]).some(a=>a.fason) ? 2 : 0;
  const vardiyaSn = 28800; // 8 saat
  const atolyeGun = toplamSn>0 ? Math.ceil(toplamSn/vardiyaSn) : 0;
  const toplamGun = atolyeGun + fasonGun;
  const termin = toplamGun>0 ? ekleIsGunuEngine(baslangic, toplamGun) : new Date(baslangic);
  return { toplamGun, atolyeGun, fasonGun, termin, toplamSn };
};

// ── STOK HAREKETİ REPOSITORY ──────────────────────────────────
// Append-only stok geçmişi. Hiçbir zaman silinmez.

const STOK_HAREKET_KEY = "atolye_stokHareketleri";

const stokHareketiRepo = {
  getAll: () => {
    try { return JSON.parse(localStorage.getItem(STOK_HAREKET_KEY)||"[]"); }
    catch { return []; }
  },
  ekle: (hareket) => {
    const liste = stokHareketiRepo.getAll();
    const yeni = {
      id: "sh-" + Date.now() + "-" + Math.random().toString(36).slice(2,6),
      createdAt: new Date().toISOString(),
      ...hareket,
    };
    liste.push(yeni);
    try { localStorage.setItem(STOK_HAREKET_KEY, JSON.stringify(liste)); } catch(e){ console.warn('[stokHareket] localStorage yazma hatası:', e?.message); }
    return yeni;
  },
  // Belirli stok kaleminin hareketleri
  byStokId: (stokId) => stokHareketiRepo.getAll().filter(h=>h.stokId===stokId),
  // Belirli UE'nin hareketleri
  byReferenceId: (refId) => stokHareketiRepo.getAll().filter(h=>h.referenceId===refId),
};

// ── WORKLOG REPOSITORY ────────────────────────────────────────
// Aşama bazlı çalışma süresi kayıtları.

const WORKLOG_KEY = "atolye_workLogs";

const workLogRepo = {
  getAll: () => {
    try { return JSON.parse(localStorage.getItem(WORKLOG_KEY)||"[]"); }
    catch { return []; }
  },
  ac: (ueId, asamaId, asamaAd, calisanAd, planlananSure) => {
    const liste = workLogRepo.getAll();
    // Zaten açık log varsa kapat
    const mevcutIdx = liste.findIndex(w=>w.uretimEmriId===ueId&&w.asamaId===asamaId&&w.durum==="devam");
    if(mevcutIdx>=0) return liste[mevcutIdx]; // Zaten açık
    const log = {
      id: "wl-" + Date.now() + "-" + Math.random().toString(36).slice(2,6),
      uretimEmriId: ueId,
      asamaId, asamaAd, calisanAd: calisanAd||"—",
      basladiAt: new Date().toISOString(),
      bittiAt: null,
      planlananSure: planlananSure||0, // saniye
      gerceklesenSure: null,
      durum: "devam",
      not: "", sorun: "",
    };
    liste.push(log);
    try { localStorage.setItem(WORKLOG_KEY, JSON.stringify(liste)); } catch(e){ console.warn('[workLog] localStorage yazma hatası:', e?.message); }
    return log;
  },
  kapat: (ueId, asamaId) => {
    if(!ueId || !asamaId) return null;
    const liste = workLogRepo.getAll();
    const idx = liste.findIndex(w=>w.uretimEmriId===ueId&&w.asamaId===asamaId&&w.durum==="devam");
    if(idx<0) return null; // Açık log yok — sessizce geç
    const log = liste[idx];
    const bittiAt = new Date().toISOString();
    const gerceklesenSure = Math.floor((new Date(bittiAt)-new Date(log.basladiAt))/1000);
    liste[idx] = { ...log, bittiAt, gerceklesenSure, durum:"bitti" };
    try { localStorage.setItem(WORKLOG_KEY, JSON.stringify(liste)); } catch(e){ console.warn('[workLog] localStorage yazma hatası:', e?.message); }
    return liste[idx];
  },
  byUE: (ueId) => workLogRepo.getAll().filter(w=>w.uretimEmriId===ueId),
};

// ── ÜRETİM SERVICE ────────────────────────────────────────────
// Üretim tamamlandığında stok düşme + hareket kaydı.
// MVP: tek seferde stok düş. Rezervasyon yok.

/**
 * uretimTamamlaService:
 * 1. Üretim emrini bul
 * 2. BOM'dan tüm ham madde tüketimini hesapla (YM stok düşürme DAHİL)
 * 3. YM stoklarını düş (stoktan kullanılan YM'ler)
 * 4. Ham madde stoklarını düş
 * 5. Bitmiş ürün stokunu artır
 * 6. StockMovement kayıtlarını yaz
 * 7. UE durumunu tamamlandi yap
 * @returns { uyarilar: [], hatalar: [] }
 */
const uretimTamamlaService = (ueId, { uretimEmirleri, hamMaddeler, yarimamulList, urunler, setUretimEmirleri, setHamMaddeler, setUrunler, setYM }) => {
  const ue = uretimEmirleri.find(e=>e.id===ueId);
  if(!ue) return { uyarilar:[], hatalar:["Üretim emri bulunamadı"] };
  if(ue.durum==="tamamlandi") return { uyarilar:["Üretim emri zaten tamamlandı"], hatalar:[] };

  const urun = urunler.find(u=>u.id===ue.urunId);
  if(!urun) return { uyarilar:[], hatalar:["Ürün bulunamadı"] };

  const uyarilar = [];
  const adet = ue.adet||1;

  // 1. YM stok tüketimini hesapla
  const ymTuketim = {}; // ymId → tüketilen miktar
  const ymTuketimHesapla = (bom, carpan=1, depth=0) => {
    if(depth > 8) return;
    (bom||[]).forEach(b => {
      if(b.tip==="yarimamul") {
        const ym = yarimamulList.find(x=>x.id===b.kalemId);
        if(!ym) return;
        const ymGereken = (b.miktar||1) * carpan * adet;
        const ymStok = ym.miktar || 0;
        const onceki = ymTuketim[ym.id] || 0;
        const kalanStok = Math.max(0, ymStok - onceki);
        const stokKullanim = Math.min(ymGereken, kalanStok);
        const uretilecek = Math.max(0, ymGereken - stokKullanim);
        ymTuketim[ym.id] = onceki + stokKullanim;
        // Üretilecek kısım için alt BOM'a in
        if(uretilecek > 0 && ym.bom?.length) {
          ymTuketimHesapla(ym.bom, uretilecek / adet, depth+1);
        }
      }
    });
  };
  ymTuketimHesapla(urun.bom);

  // 2. Ham madde tüketimini hesapla (bomMalzemeListesi zaten YM stok düşürme yapıyor)
  const malzemeliste = bomMalzemeListesi(urun, adet, hamMaddeler, yarimamulList, urunler);

  // 3. YM stoklarını düş
  if(setYM && Object.keys(ymTuketim).length > 0) {
    const yeniYM = yarimamulList.map(ym => {
      const tuketilen = ymTuketim[ym.id];
      if(!tuketilen || tuketilen <= 0) return ym;
      const yeniMiktar = (ym.miktar||0) - tuketilen;
      if(yeniMiktar < 0) {
        uyarilar.push(`⚠ YM ${ym.ad}: stok yetersiz (${Number(ym.miktar||0).toFixed(1)} var, ${Number(tuketilen).toFixed(1)} kullanıldı)`);
      }
      stokHareketiRepo.ekle({
        stokTipi: "yarimamul", stokId: ym.id,
        hareketTipi: "uretim_tuketimi", miktar: -tuketilen,
        birim: "adet", oncekiBakiye: ym.miktar||0,
        sonrakiBakiye: Math.max(0, yeniMiktar),
        kaynakModul: "uretim", referenceType: "uretim_emri",
        referenceId: ueId, note: `${ue.urunAd} - ${adet} adet üretim (YM tüketimi)`,
      });
      return { ...ym, miktar: Math.max(0, yeniMiktar) };
    });
    setYM(yeniYM);
  }

  // 4. Ham madde stoklarını düş
  const yeniHamMaddeler = hamMaddeler.map(hm => {
    const tuketim = malzemeliste.find(m=>m.id===hm.id);
    if(!tuketim || tuketim.gereken<=0) return hm;
    const yeniMiktar = (hm.miktar||0) - tuketim.gereken;
    if(yeniMiktar < 0) {
      uyarilar.push(`⚠ ${hm.ad}: stok yetersiz (${Number(hm.miktar||0).toFixed(3)} var, ${Number(tuketim.gereken).toFixed(3)} gerekli)`);
    }
    stokHareketiRepo.ekle({
      stokTipi: "hammadde", stokId: hm.id,
      hareketTipi: "uretim_tuketimi", miktar: -(tuketim.gereken),
      birim: hm.birim, oncekiBakiye: hm.miktar||0,
      sonrakiBakiye: Math.max(0, yeniMiktar),
      kaynakModul: "uretim", referenceType: "uretim_emri",
      referenceId: ueId, note: `${ue.urunAd} - ${adet} adet üretim`,
    });
    return { ...hm, miktar: Math.max(0, yeniMiktar) };
  });

  // 5. Bitmiş ürün stokunu artır
  const yeniUrunler = urunler.map(u => {
    if(u.id !== ue.urunId) return u;
    const eskiStok = u.stok||0;
    const yeniStok = eskiStok + adet;
    stokHareketiRepo.ekle({
      stokTipi: "urun", stokId: u.id,
      hareketTipi: "bitirmis_urun_giris", miktar: adet,
      birim: "adet", oncekiBakiye: eskiStok, sonrakiBakiye: yeniStok,
      kaynakModul: "uretim", referenceType: "uretim_emri",
      referenceId: ueId, note: `${ue.urunAd} üretim tamamlandı`,
    });
    return { ...u, stok: yeniStok };
  });

  // 6. State güncelle
  setHamMaddeler(yeniHamMaddeler);
  setUrunler(yeniUrunler);
  setUretimEmirleri(prev => prev.map(e => e.id===ueId
    ? { ...e, durum:"tamamlandi", tamamlanmaTarihi:new Date().toISOString() }
    : e
  ));

  return { uyarilar, hatalar:[] };
};


const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800;900&family=Inter:wght@300;400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body { background: #060608; font-family: 'Inter', sans-serif; }

  @keyframes fade-up   { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
  @keyframes fade-in   { from{opacity:0} to{opacity:1} }
  @keyframes row-in    { from{opacity:0;transform:translateX(-6px)} to{opacity:1;transform:translateX(0)} }
  @keyframes bar-in    { from{width:0} }
  @keyframes pulse-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.75)} }
  @keyframes blink     { 0%,100%{opacity:1} 50%{opacity:.1} }
  @keyframes float     { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
  @keyframes spin      { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  @keyframes orb1      { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(40px,-28px) scale(1.06)} }
  @keyframes orb2      { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-28px,20px) scale(.95)} }
  @keyframes orb3      { 0%,100%{transform:translate(0,0)} 33%{transform:translate(20px,30px)} 66%{transform:translate(-15px,-10px)} }
  @keyframes pulse-ring {
    0%,100%{box-shadow:0 0 0 0 currentColor,0 0 0 3px currentColor;opacity:1}
    50%{box-shadow:0 0 0 5px currentColor,0 0 0 10px transparent;opacity:.75}
  }
  @keyframes slide-in  { from{opacity:0;transform:translateX(16px)} to{opacity:1;transform:translateX(0)} }
  @keyframes modal-in  { from{opacity:0;transform:scale(.94) translateY(10px)} to{opacity:1;transform:scale(1) translateY(0)} }
  @keyframes ember-flicker {
    0%,100%{opacity:.55} 25%{opacity:.8} 50%{opacity:.45} 75%{opacity:.7}
  }

  input, textarea, select {
    font-family: 'Inter', sans-serif;
    color: #EDE8DF;
    background: transparent;
  }
  input::placeholder, textarea::placeholder { color: rgba(237,232,223,0.18); }
  input:focus, textarea:focus, select:focus { outline: none; }
  input[type="number"] { -moz-appearance:textfield; appearance:textfield; }
  input[type="number"]::-webkit-outer-spin-button,
  input[type="number"]::-webkit-inner-spin-button { -webkit-appearance:none; }
  select option {
    background: #10141E;
    color: #EDE8DF;
  }

  .nav-item:hover {
    background: rgba(230,130,50,0.06) !important;
    color: #E8914A !important;
    border-left-color: rgba(232,145,74,0.5) !important;
  }

  .card:hover {
    transform: translateY(-2px) !important;
    border-color: rgba(255,255,255,0.1) !important;
    box-shadow: 0 24px 64px rgba(0,0,0,.7), 0 0 0 1px rgba(232,145,74,0.08) !important;
  }

  .inp:focus {
    border-color: rgba(232,145,74,.4) !important;
    background: rgba(232,145,74,.025) !important;
  }
  .inp-name:hover { border-color: rgba(255,255,255,.09) !important; }
  .inp-name:focus { border-color: rgba(232,145,74,.35) !important; }

  .del-row { opacity:0; transition:opacity .12s; }
  .row-wrap:hover .del-row { opacity:1; }
  .del-row:hover { background:rgba(220,60,60,.15) !important; color:#DC3C3C !important; }
  .add-row:hover { background:rgba(232,145,74,.07) !important; border-color:rgba(232,145,74,.28) !important; color:#E8914A !important; }

  .btn-p:hover  { filter:brightness(1.08); transform:translateY(-1px); box-shadow:0 10px 28px rgba(200,100,30,.35) !important; }
  .btn-g:hover  { background:rgba(255,255,255,.055) !important; border-color:rgba(255,255,255,.12) !important; }
  .tab-b:hover  { background:rgba(232,145,74,.05) !important; color:rgba(237,232,223,.7) !important; }
  .stage-node:hover .tt { opacity:1 !important; transform:translateX(-50%) translateY(0) !important; }
  .cat-hdr:hover { opacity:.85; }
  .pill-btn:hover { filter:brightness(1.07); }

  .overlay {
    position:fixed; inset:0; z-index:200;
    background: rgba(0,0,0,.82);
    display:flex; align-items:center; justify-content:center;
    animation:fade-in .18s ease;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
  }
  .modal {
    background: rgba(10,10,13,0.96);
    border: 1px solid rgba(255,255,255,.07);
    border-radius: 18px;
    padding: 28px;
    min-width: 440px; max-width: 560px; width: 100%;
    animation: modal-in .2s ease;
    box-shadow: 0 40px 100px rgba(0,0,0,.8),
                0 0 0 1px rgba(232,145,74,.05),
                inset 0 1px 0 rgba(255,255,255,.05);
  }

  ::-webkit-scrollbar { width:2px; height:2px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:rgba(232,145,74,.18); border-radius:2px; }
`;

// ── TOKENS ───────────────────────────────────────────────────────────────────
const C = {
  // Pure deep backgrounds — like reference images
  bg:  "#060608",
  s1:  "#0A0A0D",
  s2:  "#0D0D11",
  s3:  "#111115",
  s4:  "#161619",

  // Borders — nearly invisible, just enough to see depth
  border:   "rgba(255,255,255,.055)",
  borderHi: "rgba(255,255,255,.1)",

  // Text — warm white, not cold
  text:  "#EDE8DF",
  sub:   "rgba(237,232,223,.48)",
  muted: "rgba(237,232,223,.24)",

  // Accent — warm orange/ember, used sparingly
  cyan:   "#E8914A",   // primary amber-orange
  mint:   "#3DB88A",   // muted green
  coral:  "#DC3C3C",   // danger
  gold:   "#C8872A",   // deeper amber
  lav:    "#7C5CBF",   // fason violet
  sky:    "#3E7BD4",   // info
  orange: "#D46B2A",   // deep orange
};
const F  = "'Montserrat', sans-serif";
const FB = "'Inter', sans-serif";

// ── HELPERS ──────────────────────────────────────────────────────────────────
const uid  = () => Math.random().toString(36).slice(2,9);
const r4   = n  => Math.round(n*10000)/10000;
const fmt  = (n,d=2) => (n==null||isNaN(n)) ? "—" : n.toLocaleString("tr-TR",{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtK = n  => n>=1000 ? fmt(n/1000,1)+"k" : fmt(n,0);

function calcRow(row, listeFiyat) {
  const birim = row.priceMode==="liste" ? (listeFiyat||0)*(1-row.discount/100) : (row.manualPrice||0)*(1-row.discount/100);
  const matrah=r4(birim*row.qty), kdv=r4(matrah*row.kdv/100);
  return { birim:r4(birim), matrah, kdv, total:r4(matrah+kdv) };
}

// ── INITIAL STATE ─────────────────────────────────────────────────────────────

const INIT_ISTASYONLAR = [
  {id:"is1", ad:"Kesim Masası",    tip:"ic",    kapasite:"8 saat/gün",  calisan:"Fatma H.",  durum:"aktif",  notlar:""},
  {id:"is2", ad:"Dikiş Atölyesi",  tip:"ic",    kapasite:"8 saat/gün",  calisan:"Fatma H.",  durum:"aktif",  notlar:""},
  {id:"is3", ad:"Hazırlık",        tip:"ic",    kapasite:"8 saat/gün",  calisan:"Mehmet",    durum:"aktif",  notlar:""},
  {id:"is4", ad:"Döşeme Tezgahı",  tip:"ic",    kapasite:"8 saat/gün",  calisan:"Ahmet Usta",durum:"aktif",  notlar:""},
  {id:"is5", ad:"Montaj",          tip:"ic",    kapasite:"4 saat/gün",  calisan:"Ahmet Usta",durum:"aktif",  notlar:""},
  {id:"is6", ad:"Paketleme",       tip:"ic",    kapasite:"4 saat/gün",  calisan:"Mehmet",    durum:"aktif",  notlar:""},
  {id:"is7", ad:"Statik Boya",     tip:"fason", kapasite:"Parti bazlı", calisan:"—",         durum:"fason",  notlar:"Ortalama 2 gün bekleme"},
  {id:"is8", ad:"Kaynak Atölyesi", tip:"fason", kapasite:"Parti bazlı", calisan:"—",         durum:"fason",  notlar:""},
];

const INIT_CALISANLAR = [
  {id:"c1", ad:"Ahmet Usta", rol:"Döşemeci Usta",   tel:"0532 xxx xx xx", durum:"aktif", istasyon:"Döşeme Tezgahı / Montaj"},
  {id:"c2", ad:"Fatma H.",   rol:"Dikişçi / Kesimci",tel:"0535 xxx xx xx", durum:"aktif", istasyon:"Kesim Masası / Dikiş"},
  {id:"c3", ad:"Mehmet",     rol:"Hazırlık / Depo",  tel:"0541 xxx xx xx", durum:"aktif", istasyon:"Hazırlık / Paketleme"},
];

const INIT_FASON = [
  {id:"f1", ad:"Boya Atölyesi A",  tip:"Elektrostatik Boya", tel:"", adres:"", sureGun:2, birimFiyat:50,  kdv:20, notlar:""},
  {id:"f2", ad:"Metal Lazer B",    tip:"Lazer Kesim / Kaynak",tel:"", adres:"", sureGun:3, birimFiyat:51,  kdv:20, notlar:"Profil işçiliği 30₺ + lazer 21₺"},
];

const INIT_URUNLER = [];

// ── REÇETE DATA ───────────────────────────────────────────────────────────────
const INIT_RECETELER = {};

const INIT_MALIYET = {};

const INIT_PARAMS = {targetSaleKdvDahil:0, saleKdv:10, gelirVergisi:30};

const INIT_SIPARISLER = [];

// ── YÜCEL PROFİL & BORU FİYAT LİSTESİ ───────────────────────────────────────
const YUCEL_DATA = {
  "Profil": {
    "HR": {
      "15x15 / 10x20":              { "1.20":28.68, "1.50":34.50, "2.00":43.41 },
      "16x16":                       { "2.00":39.59 },
      "20x20 / 10x30 / 15x25":      { "1.20":35.79, "1.40":40.05, "1.50":41.14, "1.90":48.15, "2.00":49.18, "2.50":64.41 },
      "15x30":                       { "2.00":49.55, "2.50":62.83 },
      "25x25 / 20x30":               { "1.20":44.95, "1.40":47.75, "1.50":49.73, "1.90":58.70, "2.00":59.23, "2.50":75.54, "3.00":89.35 },
      "10x40":                       { "1.50":48.59, "2.00":55.54, "2.50":64.91, "3.00":82.28 },
      "15x40 / 20x35":               { "2.00":61.80, "2.50":79.89 },
      "25x35":                       { "2.00":66.66, "2.50":81.67 },
      "10x50 / 15x45":               { "2.00":67.31, "2.50":83.97 },
      "30x30 / 20x40":               { "1.20":53.42, "1.40":57.19, "1.50":59.29, "1.90":70.75, "2.00":72.92, "2.50":88.71, "3.00":106.34, "4.00":153.37 },
      "25x40":                       { "2.00":70.16, "2.50":87.50, "3.00":105.28, "4.00":125.27 },
      "30x40":                       { "1.20":63.07, "1.40":66.38, "1.50":68.55, "1.90":82.38, "2.00":84.81, "2.50":104.74, "3.00":123.89 },
      "35x35 / 20x50":               { "2.00":71.55, "2.50":88.46, "3.00":106.28, "4.00":129.86 },
      "25x50":                       { "2.00":82.27, "2.50":101.68, "3.00":121.66, "4.00":146.37 },
      "40x40 / 30x50":               { "1.20":72.12, "1.40":76.27, "1.50":78.47, "1.90":93.13, "2.00":95.62, "2.50":112.29, "3.00":134.46, "4.00":185.50 },
      "20x60":                       { "2.00":89.97, "2.50":109.93 },
      "45x45 / 30x60 / 40x50":      { "2.00":101.64, "2.50":123.22, "3.00":148.12, "4.00":174.76, "5.00":234.68, "6.00":292.31 },
      "50x50 / 40x60":               { "1.20":94.76, "1.50":100.02, "2.00":121.16, "2.50":141.68, "3.00":169.67, "4.00":173.68, "5.00":232.09, "6.00":287.41 },
      "30x70":                       { "1.50":96.86, "2.00":129.93, "2.50":156.04, "3.00":183.42, "4.00":243.12 },
      "20x80":                       { "2.00":113.70, "2.50":145.98, "3.00":163.95, "4.00":208.74 },
      "30x80 / 40x70 / 50x60":      { "2.00":129.30, "2.50":156.20, "3.00":187.26, "4.00":222.99, "5.00":291.94, "6.00":363.07 },
      "60x60 / 40x80":               { "1.50":114.97, "2.00":143.79, "2.50":172.66, "3.00":207.63, "4.00":212.02, "5.00":284.68, "6.00":357.78 },
      "50x70":                       { "2.00":156.91, "3.00":187.52, "4.00":223.51, "5.00":299.04, "6.00":373.56 },
      "30x90":                       { "2.00":164.50, "3.00":203.25, "4.00":236.67 },
      "20x100":                      { "2.00":177.67 },
      "30x100 / 50x80":              { "2.00":149.42, "2.50":186.30, "3.00":225.22, "4.00":262.10, "5.00":339.70, "6.00":421.04 },
      "30x110":                      { "2.00":166.84 },
      "70x70 / 50x90 / 60x80 / 40x100": { "1.50":154.50, "2.00":181.89, "2.50":206.08, "3.00":245.63, "4.00":252.55, "5.00":334.75, "6.00":423.23, "8.00":548.27 },
      "50x100":                      { "1.40":188.52, "2.00":181.14, "2.50":193.44, "3.00":263.88, "4.00":269.64, "5.00":351.76, "6.00":440.14, "8.00":557.19 },
      "75x75":                       { "2.00":203.39, "3.00":284.81 },
      "80x80 / 60x100":              { "2.00":175.72, "2.50":207.93, "3.00":280.06, "4.00":287.63, "5.00":377.05, "6.00":475.19, "8.00":575.95 },
      "40x120":                      { "2.00":217.52, "3.00":254.29, "4.00":299.61, "5.00":395.58, "6.00":494.24 },
      "40x130 / 50x120 / 70x100":   { "3.00":288.43, "4.00":359.98, "5.00":481.94, "6.00":592.16 },
      "60x120 / 80x100 / 90x90":    { "2.00":234.56, "2.50":265.55, "3.00":326.67, "4.00":434.06, "5.00":534.41, "6.00":664.31 },
      "40x140 / 70x110":             { "4.00":368.11, "5.00":479.91, "6.00":594.89 },
      "70x120":                      { "2.50":268.74, "3.00":328.69, "4.00":385.95 },
      "50x150":                      { "3.00":292.34, "4.00":334.17, "5.00":396.75, "6.00":517.82, "8.00":648.13, "10.00":773.17 },
      "60x140":                      { "3.00":320.96, "4.00":389.41, "5.00":512.95, "6.00":632.27, "8.00":818.51 },
      "100x100 / 80x120":            { "2.00":266.33, "2.50":303.30, "3.00":367.99, "4.00":483.20, "5.00":593.98, "6.00":726.52, "8.00":1007.76 },
      "80x140 / 110x110 / 100x120": { "4.00":437.01, "5.00":440.85, "6.00":575.79, "8.00":712.73, "10.00":855.81 },
      "120x120 / 80x160":            { "4.00":447.76, "5.00":580.69, "6.00":729.01, "8.00":885.61, "10.00":1229.48 },
      "100x150":                     { "5.00":486.49, "6.00":649.83, "8.00":807.49, "10.00":991.68 },
      "140x140":                     { "6.00":640.80, "8.00":751.44, "10.00":918.64 },
      "80x200 / 100x180":            { "6.00":649.08, "8.00":787.64, "10.00":959.27 },
      "150x150 / 100x200":           { "4.00":660.67, "5.00":822.83, "6.00":1002.01, "8.00":1217.85, "10.00":1653.82 },
      "175x175 / 150x200":           { "6.00":887.73, "8.00":999.18, "10.00":1235.08 },
      "200x200 / 150x250":           { "4.00":1157.03, "5.00":1443.01, "6.00":1741.00, "8.00":2392.91, "10.00":3106.70 },
      "250x250 / 200x300":           { "8.00":1831.97, "10.00":2174.29 }
    },
    "CR": {
      "10x10":                       { "0.70":15.40, "0.80":16.37, "0.90":18.20, "1.00":19.68, "1.20":23.46 },
      "15x15 / 10x20":               { "0.70":18.70, "0.80":19.01, "0.90":21.20, "1.00":23.46, "1.20":27.87, "1.50":33.95, "2.00":40.53 },
      "15x20":                       { "0.80":24.84, "0.90":26.07, "1.00":28.69, "1.20":34.09, "1.50":40.86 },
      "20x20 / 10x30 / 15x25":      { "0.70":23.29, "0.80":24.59, "0.90":27.73, "1.00":30.54, "1.20":36.29, "1.50":43.67, "2.00":57.23 },
      "15x30":                       { "1.00":35.73, "1.20":43.19, "1.50":51.72, "2.00":67.73 },
      "25x25 / 20x30":               { "0.70":28.84, "0.80":30.03, "0.90":33.97, "1.00":37.20, "1.20":45.07, "1.50":55.45, "2.00":71.88 },
      "10x40":                       { "1.20":41.59, "1.50":47.09, "2.00":59.82 },
      "15x40 / 20x35":               { "0.80":44.71, "0.90":45.93, "1.00":54.01, "1.20":66.57, "1.50":83.80 },
      "10x50":                       { "1.20":58.25, "1.50":74.94, "2.00":96.66 },
      "30x30 / 20x40":               { "0.70":36.89, "0.80":37.20, "0.90":40.51, "1.00":45.07, "1.20":53.38, "1.50":66.76, "2.00":87.09 },
      "25x40":                       { "0.70":40.33, "0.80":40.68, "0.90":44.65, "1.00":49.40, "1.20":61.38, "1.50":74.31, "2.00":92.53 },
      "20x50 / 35x35":               { "0.90":50.99, "1.00":54.34, "1.20":65.17, "2.00":88.39 },
      "30x40":                       { "0.70":43.36, "0.80":48.43, "0.90":53.61, "1.00":63.03, "1.20":77.33, "2.00":104.12 },
      "25x50":                       { "0.80":59.74, "0.90":61.50, "1.00":75.61, "1.20":89.10, "2.00":114.88 },
      "40x40 / 30x50":               { "0.80":57.50, "0.90":62.01, "1.00":62.29, "1.20":72.06, "1.50":88.61, "2.00":115.86 },
      "20x60 / 25x55":               { "0.80":63.53, "0.90":71.89, "1.00":86.42, "2.00":124.89 },
      "45x45 / 30x60 / 40x50":      { "1.00":77.60, "1.20":87.45, "1.50":103.52, "2.00":134.90 },
      "50x50 / 40x60":               { "1.20":95.03, "1.50":110.78, "2.00":145.54 },
      "30x70":                       { "0.90":91.19, "1.00":97.16, "1.20":115.19, "2.00":147.71 },
      "20x80":                       { "1.00":101.76, "1.20":119.33, "2.00":149.03 },
      "60x60 / 40x80":               { "1.20":116.03, "1.50":140.77, "2.00":185.33 },
      "20x100":                      { "2.00":210.14 },
      "30x100":                      { "2.00":217.98 },
      "70x70 / 60x80 / 50x90 / 40x100": { "1.50":171.47, "2.00":216.54 },
      "50x100":                      { "2.00":242.16 },
      "80x80 / 60x100":              { "2.00":266.52 },
      "40x120":                      { "2.00":274.69 },
      "90x90 / 60x120 / 80x100":    { "2.00":285.62 }
    }
  },
  "Boru": {
    "HR": {
      "13":    { "1.50":27.33 },
      "16":    { "1.50":30.85 },
      "17":    { "1.50":33.00, "2.00":41.61 },
      "18":    { "1.50":34.88 },
      "19":    { "1.40":35.03, "1.50":36.55, "2.00":41.02 },
      "20":    { "1.50":38.43, "2.00":45.95 },
      "21.3":  { "1.50":38.50, "1.90":45.66, "2.00":47.03, "2.50":56.49 },
      "22":    { "1.50":41.71, "2.00":51.70, "3.00":65.64 },
      "25":    { "1.50":42.76, "2.00":51.90, "2.50":65.41, "3.00":77.23 },
      "26.9":  { "1.50":45.05, "1.90":53.39, "2.00":53.63, "2.40":62.45, "2.50":64.37, "3.00":75.75 },
      "28":    { "1.50":48.54, "2.00":62.55 },
      "30":    { "1.50":53.20, "2.00":66.76 },
      "32":    { "1.50":51.93, "1.90":62.35, "2.00":63.08, "2.50":78.17, "3.00":93.26 },
      "33.7":  { "1.50":55.08, "1.90":66.14, "2.00":66.48, "2.40":77.78, "2.50":80.14, "3.00":94.78, "3.20":106.86, "4.00":132.36 },
      "35":    { "1.50":63.65, "2.00":76.58, "3.00":90.24 },
      "38":    { "1.50":63.76, "2.00":77.90, "3.00":93.96, "4.00":110.84, "6.00":151.65 },
      "40":    { "1.50":69.66, "2.00":88.71, "3.00":104.76, "4.00":123.42, "6.00":162.40 },
      "42.4":  { "1.40":67.81, "1.50":69.40, "1.90":83.52, "2.00":85.76, "2.50":101.25, "3.00":119.00, "3.20":147.66, "4.00":163.23 },
      "45":    { "1.50":75.67, "2.00":92.94, "3.00":112.87, "4.00":133.89 },
      "48.3":  { "1.40":75.97, "1.50":78.01, "1.90":92.61, "2.00":96.88, "2.40":111.40, "2.50":114.85, "3.00":135.87, "3.20":172.56, "4.00":188.78, "5.00":235.49 },
      "50":    { "1.50":85.32, "2.00":103.92, "3.00":123.41, "4.00":146.80, "6.00":203.07, "8.00":256.03 },
      "51":    { "1.50":85.77, "1.90":101.74, "2.00":104.86, "2.40":121.75, "2.50":125.52, "3.00":149.04, "3.20":163.20, "5.00":203.43, "8.00":257.23 },
      "57":    { "1.50":106.70, "2.00":128.28, "3.00":154.21, "4.00":182.92, "6.00":240.95, "8.00":300.06 },
      "60.3":  { "1.50":99.77, "1.90":116.89, "2.00":120.67, "2.40":142.49, "2.50":145.96, "3.00":172.01, "3.20":217.81, "4.00":229.62, "5.00":293.16 },
      "63":    { "2.50":142.55, "3.00":171.15, "4.00":203.66, "8.00":339.09 },
      "63.5":  { "3.20":203.87, "6.00":262.81, "8.00":340.17 },
      "70":    { "1.50":128.24, "2.00":156.95, "3.00":188.93, "4.00":224.39, "6.00":296.29, "8.00":370.30 },
      "76.1":  { "1.50":127.72, "2.00":153.63, "2.40":181.14, "2.50":186.15, "3.00":215.28, "3.20":275.65, "4.00":292.71, "5.00":372.73 },
      "88.9":  { "1.50":166.27, "2.00":186.56, "2.50":219.67, "3.00":261.33, "4.00":342.76, "5.00":438.55, "6.00":567.35 },
      "101.6": { "2.50":215.96, "3.00":261.36, "4.00":311.91, "5.00":380.95, "6.00":410.29, "8.00":520.50, "10.00":630.79 },
      "108":   { "2.50":252.05, "3.00":299.86, "4.00":352.41, "6.00":463.87, "8.00":572.94, "10.00":705.51 },
      "114.3": { "2.00":241.08, "2.50":285.62, "3.00":339.96, "4.00":449.44, "5.00":565.21, "6.00":700.90, "6.30":770.82 },
      "127":   { "3.00":364.82, "4.00":391.65, "5.00":516.58, "6.00":641.82, "8.00":782.39, "10.00":1063.29 },
      "139.7": { "3.00":372.81, "4.00":433.45, "5.00":569.90, "6.00":708.44, "6.30":861.17, "8.00":1219.03 },
      "150":   { "4.00":498.46, "8.00":660.41 },
      "152":   { "2.50":428.98, "3.00":498.62, "6.00":681.02, "8.00":821.74 },
      "156":   { "4.00":699.73, "6.00":845.23, "8.00":1044.31, "10.00":1434.03 },
      "159":   { "3.00":544.05, "5.00":702.99, "6.00":875.03, "8.00":1064.44 },
      "168.3": { "4.00":557.45, "5.00":697.94, "6.00":867.00, "6.30":1061.95, "8.00":1440.91 },
      "191":   { "3.00":697.39, "5.00":886.92, "6.00":1061.19, "8.00":1275.22, "10.00":1810.33 },
      "219.1": { "4.00":803.24, "5.00":963.76, "6.00":1188.25, "6.30":1436.39, "8.00":1986.49 },
      "273":   { "4.00":1263.52, "6.00":1539.31, "8.00":1910.51, "10.00":2626.40 },
      "323.3": { "6.00":1869.97, "8.00":2267.62, "10.00":3166.32 }
    },
    "CR": {
      "8":     { "0.70":13.63, "0.80":13.93, "0.90":15.78, "1.00":17.81, "1.20":20.15, "1.50":23.94 },
      "9":     { "0.80":18.03 },
      "10":    { "0.60":13.45, "0.70":13.93, "0.80":14.42, "0.90":16.41, "1.00":18.29, "1.20":21.32, "1.50":25.29 },
      "12":    { "1.00":20.22, "1.50":27.66, "2.00":34.05 },
      "13":    { "0.60":15.94, "0.70":16.24, "0.80":16.41, "0.90":17.34, "1.00":20.53, "1.20":24.47, "1.50":28.41, "2.00":43.65 },
      "14":    { "2.00":37.89 },
      "16":    { "0.60":18.03, "0.70":18.74, "0.80":19.48, "0.90":21.38, "1.00":22.95, "1.20":27.74, "1.50":32.49, "2.00":41.41 },
      "17":    { "2.00":43.78 },
      "18":    { "0.80":19.85, "1.00":23.82, "1.50":33.47 },
      "19":    { "0.60":18.70, "0.70":19.50, "0.80":20.04, "0.90":22.18, "1.00":24.82, "1.20":29.87, "1.50":36.90, "2.00":48.86 },
      "20":    { "1.00":26.93, "1.20":31.05, "1.50":38.45, "2.00":51.43 },
      "21":    { "0.60":18.89, "0.70":20.53, "0.80":21.81, "0.90":24.49, "1.00":27.16, "1.20":31.64, "1.50":38.59, "2.00":52.65 },
      "22":    { "0.70":21.87, "0.80":23.64, "0.90":26.43, "1.00":29.40, "1.20":34.62, "1.50":41.95, "2.00":55.64 },
      "25":    { "0.60":22.18, "0.70":24.45, "0.80":25.29, "0.90":28.51, "1.00":31.35, "1.20":37.87, "1.50":45.56, "2.00":62.54 },
      "25.4":  { "1.00":32.45, "1.20":40.39, "1.50":48.86, "2.00":64.68 },
      "27":    { "1.20":43.60, "1.50":50.33, "2.00":66.57 },
      "28":    { "0.70":27.36, "0.80":29.71, "0.90":34.30, "1.00":36.77, "1.20":44.80, "1.50":53.01, "2.00":70.74 },
      "28.6":  { "1.00":38.23, "1.20":46.29, "1.50":55.31, "2.00":73.41 },
      "30":    { "0.80":31.66, "0.90":35.74, "1.00":39.65, "1.20":47.60, "1.50":57.28, "2.00":76.70 },
      "32":    { "0.70":31.15, "0.80":32.10, "0.90":35.96, "1.00":39.92, "1.20":47.66, "1.50":57.35, "2.00":79.09 },
      "34":    { "1.20":52.14, "1.50":62.97, "2.00":83.06 },
      "35":    { "0.80":35.98, "0.90":40.68, "1.00":45.30, "1.20":54.84, "1.50":65.65, "2.00":84.03 },
      "38":    { "0.70":36.40, "0.80":38.60, "0.90":43.36, "1.00":47.92, "1.20":58.25, "1.50":69.74, "2.00":94.84 },
      "40":    { "0.90":47.09, "1.00":51.57, "1.20":62.48, "1.50":75.61, "2.00":99.11 },
      "42":    { "0.80":48.68, "0.90":48.90, "1.00":52.94, "1.20":64.14, "1.50":75.80, "2.00":104.54 },
      "45":    { "0.70":45.93, "0.80":52.20, "0.90":52.98, "1.00":57.30, "1.20":68.47, "1.50":82.87, "2.00":112.69 },
      "48":    { "1.00":62.66, "1.20":74.95, "1.50":90.75, "2.00":120.06 },
      "50":    { "1.20":79.78, "1.50":91.85, "2.00":128.16 },
      "51":    { "0.80":65.36, "0.90":66.46, "1.00":80.57, "1.20":96.19, "1.50":129.75 },
      "57":    { "1.00":82.51, "1.20":90.08, "1.50":110.11, "2.00":145.88 },
      "60":    { "1.00":88.78, "1.20":97.91, "1.50":116.96, "2.00":154.42 },
      "70":    { "1.50":136.49, "2.00":170.07 },
      "76":    { "1.20":124.47, "1.50":142.41, "2.00":185.36 },
      "89":    { "1.50":186.93, "2.00":219.20 },
      "101.6": { "2.00":264.09 },
      "114":   { "2.00":292.95 }
    },
    "Galvanizli": {
      "21.3":  { "2.00":63.50 },
      "26.9":  { "2.00":80.00, "2.50":90.46, "3.00":106.08 },
      "33.7":  { "2.00":97.19, "2.50":113.67, "3.00":133.78 },
      "42.4":  { "2.00":122.89, "2.50":140.79, "3.00":166.60 },
      "48.3":  { "2.00":137.53, "2.50":158.69, "3.00":187.10 },
      "60.3":  { "2.00":173.54, "2.50":198.06, "3.00":235.37 },
      "76.1":  { "2.00":251.64, "2.50":300.45 },
      "88.9":  { "2.00":307.17, "2.50":367.70 },
      "114.3": { "2.00":482.67 }
    }
  },
  "Oval Profil": {
    "Düz Oval (CR)": {
      "14x24": { "0.70":24.92, "0.80":27.72, "0.90":29.89 },
      "15x30": { "0.70":27.12, "0.80":29.18, "0.90":31.05, "1.00":34.09, "1.20":40.49, "1.50":47.87, "2.00":62.54 },
      "15x35": { "0.80":33.49, "0.90":37.08, "1.00":37.44, "1.20":45.15, "1.50":54.32, "2.00":77.77 },
      "16x34": { "1.50":56.27 },
      "16x40": { "1.00":42.22, "1.20":50.50, "1.50":61.38, "2.00":81.24 },
      "20x40": { "0.80":38.36, "0.90":41.55, "1.00":44.34, "1.20":53.04, "1.50":64.13, "2.00":85.01 },
      "20x50": { "1.50":85.58, "2.00":108.16 },
      "25x50": { "1.00":59.38, "1.20":66.15, "1.50":80.39, "2.00":108.28 },
      "25x55": { "1.20":78.56, "1.50":96.31, "2.00":125.22 },
      "32x50": { "1.20":71.33, "1.50":86.17, "2.00":114.03 }
    },
    "Düz Oval (HR)": {
      "32x50": { "2.00":86.31, "3.00":106.37 }
    },
    "Elips (CR)": {
      "20x40": { "0.80":40.00, "0.90":47.21, "1.00":53.04, "1.20":62.17, "1.50":82.09 }
    }
  },
  "Özel Ebat Profil": {
    "D Profil (CR)":           { "30x40": { "0.80":54.58, "0.90":60.71, "1.00":65.18, "1.20":78.07, "1.50":112.75 } },
    "Göz Yaşı Damlası (CR)":   { "30x45": { "0.80":53.62, "1.00":70.84 } },
    "Altıgen Profil (CR)":     { "18x56": { "1.00":65.78 } },
    "Omega (HR)":              { "OMEGA": { "2.00":219.25, "3.00":320.66 } }
  }
};
const YUCEL_CATS = Object.keys(YUCEL_DATA);

// ── BİRİM GRUPLARI ────────────────────────────────────────────────────────────
// Birim grupları ve dönüşüm
const BIRIM_GRUPLARI = {
  uzunluk:{label:"Uzunluk",birimler:[{id:"mm",label:"mm",base:1},{id:"cm",label:"cm",base:10},{id:"mt",label:"mt",base:1000},{id:"boy",label:"boy",base:null,custom:true}]},
  alan:   {label:"Alan",   birimler:[{id:"cm2",label:"cm²",base:1},{id:"m2",label:"m²",base:10000}]},
  hacim:  {label:"Hacim",  birimler:[{id:"cm3",label:"cm³",base:1},{id:"lt",label:"litre",base:1000},{id:"m3",label:"m³",base:1000000}]},
  agirlik:{label:"Ağırlık",birimler:[{id:"gr",label:"gr",base:1},{id:"kg",label:"kg",base:1000}]},
  adet:   {label:"Adet",   birimler:[{id:"adet",label:"adet",base:1},{id:"takim",label:"takım",base:1},{id:"set",label:"set",base:1},{id:"plaka",label:"plaka",base:1},{id:"rulo",label:"rulo",base:1},{id:"top",label:"top",base:1},{id:"kutu",label:"kutu",base:1}]},
};
const TUM_BIRIMLER = Object.entries(BIRIM_GRUPLARI).flatMap(([g,grp])=>grp.birimler.map(b=>({...b,grup:g})));

// netFiyat: engine'e yönlendirildi
const netFiyat = _netFiyat;

// ymBirimMaliyet: engine'e yönlendirildi
const ymBirimMaliyet = _ymBirimMaliyet;

// bomKalemMaliyet: engine'e yönlendirildi
const bomKalemMaliyet = _bomKalemMaliyet;

const INIT_HAM_MADDE = [];

const INIT_YARI_MAMUL = [];

const INIT_HIZMET = [];

const INIT_URUN_BOM = [];

// Legacy stok — eski sayfalar için (stok takibi / reçete uyumu)
const INIT_STOK = [];

// ── SHARED COMPONENTS ─────────────────────────────────────────────────────────

function Badge({label,color,small}){
  return <span style={{background:`${color}14`,color,border:`1px solid ${color}28`,
    borderRadius:100,padding:small?"1px 8px":"3px 11px",fontSize:small?9:11,fontWeight:700,
    whiteSpace:"nowrap",letterSpacing:.2}}>{label}</span>;
}

function Btn({children,onClick,variant="ghost",color,style={},className=""}){
  if(variant==="primary") return(
    <button onClick={onClick} className={`btn-p ${className}`} style={{
      background:color
        ?`linear-gradient(135deg,${color},${color}cc)`
        :`linear-gradient(135deg,#F59E0B,#D97706)`,
      border:"none",borderRadius:10,padding:"9px 18px",fontWeight:700,fontSize:13,
      color:color?"#fff":"#0C0800",
      cursor:"pointer",fontFamily:FB,
      boxShadow:`0 4px 16px ${color||"rgba(245,158,11,0.3)"}`,
      transition:"all .2s",...style}}>
      {children}
    </button>
  );
  return(
    <button onClick={onClick} className={`btn-g ${className}`} style={{
      background:"rgba(255,255,255,0.04)",
      backdropFilter:"blur(8px)",
      border:`1px solid rgba(255,255,255,0.09)`,borderRadius:10,
      padding:"9px 16px",fontWeight:500,fontSize:13,color:C.sub,cursor:"pointer",fontFamily:FB,
      transition:"all .2s",...style}}>
      {children}
    </button>
  );
}

function PageHeader({title,sub,action}){
  return(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:24,flexWrap:"wrap",gap:12}}>
      <div>
        <h1 style={{fontSize:26,fontWeight:800,fontFamily:F,letterSpacing:-.5,margin:"0 0 3px",
          backgroundImage:`linear-gradient(135deg, ${C.text} 50%, ${C.cyan})`,
          WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>{title}</h1>
        {sub&&<p style={{color:C.muted,fontSize:13}}>{sub}</p>}
      </div>
      {action}
    </div>
  );
}

function Field({label,children,style={},hint}){
  return(
    <div style={{marginBottom:14,...style}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:5}}>
        <span style={{fontSize:11,fontWeight:600,color:C.muted,letterSpacing:.4}}>{label}</span>
        {hint&&<span style={{fontSize:9,color:C.cyan,opacity:.7}}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function TextInp({value,onChange,placeholder="",style={}}){
  return <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
    className="inp" style={{width:"100%",background:"rgba(255,255,255,.04)",border:`1px solid ${C.border}`,
      borderRadius:9,padding:"9px 12px",fontSize:13,color:C.text,transition:"all .15s",...style}}/>;
}

function NumInp({value,onChange,suffix,width=80,step=1,min=0,style={}}){
  return(
    <div style={{position:"relative",display:"inline-flex",alignItems:"center",...style}}>
      <input type="number" step={step} min={min} value={value??""} className="inp"
        onChange={e=>onChange(e.target.value===""?null:parseFloat(e.target.value))}
        style={{width,background:"rgba(255,255,255,.04)",border:`1px solid ${C.border}`,
          borderRadius:9,padding:`8px ${suffix?22:10}px 8px 10px`,fontSize:13,color:C.text,
          textAlign:"right",transition:"all .15s"}}/>
      {suffix&&<span style={{position:"absolute",right:8,fontSize:11,color:C.muted,pointerEvents:"none"}}>{suffix}</span>}
    </div>
  );
}

function Select({value,onChange,options,style={}}){
  return(
    <select value={value} onChange={e=>onChange(e.target.value)}
      style={{width:"100%",background:"#161C2A",border:`1px solid ${C.border}`,borderRadius:9,
        padding:"9px 12px",fontSize:13,color:C.text,cursor:"pointer",transition:"all .15s",...style}}>
      {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Modal({title,onClose,children,width=520,footer,maxHeight}){
  return(
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}
        style={{maxWidth:width, maxHeight:maxHeight||"90vh",
          display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {/* Başlık — sabit */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
          padding:"0 0 16px 0",flexShrink:0,borderBottom:`1px solid ${C.border}`,marginBottom:16}}>
          <h3 style={{fontSize:17,fontWeight:800,color:C.text,fontFamily:F,margin:0}}>{title}</h3>
          <button onClick={onClose} style={{background:"rgba(255,255,255,.06)",border:`1px solid ${C.border}`,
            borderRadius:8,width:30,height:30,cursor:"pointer",color:C.muted,fontSize:16,
            display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>×</button>
        </div>
        {/* İçerik — scrollable */}
        <div style={{overflowY:"auto",flex:1,minHeight:0,paddingRight:4}}>
          {children}
        </div>
        {/* Footer — sabit */}
        {footer&&<div style={{display:"flex",gap:8,justifyContent:"flex-end",
          marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`,flexShrink:0}}>{footer}</div>}
      </div>
    </div>
  );
}

function SilButonu({onDelete,label="Sil",isim=""}){
  const [adim,setAdim]=useState(0); // 0=normal, 1=emin misin, 2=son onay
  if(adim===0) return(
    <button onClick={()=>setAdim(1)} style={{background:"transparent",border:`1px solid ${C.border}`,
      borderRadius:8,padding:"7px 13px",fontSize:12,color:C.muted,cursor:"pointer",transition:"all .15s"}}>
      🗑 {label}
    </button>
  );
  if(adim===1) return(
    <div style={{display:"flex",gap:4,alignItems:"center",animation:"fade-in .15s ease"}}>
      <span style={{fontSize:11,color:C.coral,fontWeight:600}}>{isim?"\""+isim+"\" silinsin mi?":"Emin misiniz?"}</span>
      <button onClick={()=>setAdim(2)} style={{background:`${C.coral}18`,border:`1px solid ${C.coral}40`,
        borderRadius:7,padding:"5px 10px",fontSize:11,fontWeight:700,color:C.coral,cursor:"pointer"}}>Evet</button>
      <button onClick={()=>setAdim(0)} style={{background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,
        borderRadius:7,padding:"5px 10px",fontSize:11,color:C.muted,cursor:"pointer"}}>İptal</button>
    </div>
  );
  return(
    <div style={{display:"flex",gap:4,alignItems:"center",animation:"fade-in .15s ease"}}>
      <span style={{fontSize:11,color:C.coral,fontWeight:700}}>⚠ Bu işlem geri alınamaz!</span>
      <button onClick={()=>{onDelete();setAdim(0);}} style={{background:`linear-gradient(135deg,${C.coral},#B91C1C)`,
        border:"none",borderRadius:7,padding:"5px 12px",fontSize:11,fontWeight:700,color:"#fff",cursor:"pointer"}}>Kalıcı Sil</button>
      <button onClick={()=>setAdim(0)} style={{background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,
        borderRadius:7,padding:"5px 10px",fontSize:11,color:C.muted,cursor:"pointer"}}>Vazgeç</button>
    </div>
  );
}

function Ring({pct,size=52,col}){
  const r=(size-6)/2,ci=2*Math.PI*r,off=ci-(pct/100)*ci;
  return(
    <div style={{position:"relative",width:size,height:size,flexShrink:0}}>
      <svg width={size} height={size} style={{transform:"rotate(-90deg)",position:"absolute"}}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={5}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth={4}
          strokeDasharray={ci} strokeDashoffset={off} strokeLinecap="round"
          style={{filter:`drop-shadow(0 0 5px ${col})`,transition:"stroke-dashoffset 1.5s ease"}}/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",
        fontSize:10,fontWeight:700,color:col,fontFamily:F}}>{pct}%</div>
    </div>
  );
}

// ── DURUM META ────────────────────────────────────────────────────────────────
const DURUM_META = {
  bekliyor:    {label:"Bekliyor",        col:C.gold},
  hazir:       {label:"Sevkiyata Hazır", col:C.mint},
  uretimde:    {label:"Üretimde",        col:C.cyan},
  bloke:       {label:"Bloke",           col:C.coral},
  sevk_edildi: {label:"Sevk Edildi",     col:C.sky},
  tamamlandi:  {label:"Tamamlandı",      col:"#888"},
  iptal:       {label:"İptal",           col:"#555"},
  bitti:       {label:"Bitti",           col:C.mint},
  devam:       {label:"Devam",           col:C.cyan},
  fason:       {label:"Fason",           col:C.lav},
  aktif:       {label:"Aktif",           col:C.mint},
  ic:          {label:"İç",              col:C.cyan},
};
const dm = k => DURUM_META[k]||{label:k,col:C.muted};

// ── STAGE TIMELINE ────────────────────────────────────────────────────────────
function Timeline({asamalar,compact=false}){
  const show = compact ? asamalar.slice(0,5) : asamalar;
  const more = compact && asamalar.length>5 ? asamalar.length-5 : 0;
  const stageCol = s => s==="bitti"?C.mint:s==="devam"?C.cyan:s==="bloke"?C.coral:"rgba(255,255,255,.14)";
  return(
    <div style={{display:"flex",alignItems:"center",gap:0,marginTop:12,overflowX:"auto",paddingBottom:2,flexWrap:"nowrap"}}>
      {show.map((s,i)=>{
        const col=stageCol(s.durum);
        const isDone=s.durum==="bitti",isActive=s.durum==="devam",isBlocked=s.durum==="bloke";
        return(
          <div key={s.id} style={{display:"flex",alignItems:"center",flexShrink:0}}>
            {i>0&&<div style={{width:compact?18:26,height:2,background:isDone?`${C.mint}60`:"rgba(255,255,255,.1)"}}/>}
            <div className="stage-node" style={{position:"relative",display:"flex",flexDirection:"column",alignItems:"center",gap:5}}>
              <div style={{width:compact?32:40,height:compact?32:40,borderRadius:"50%",border:`2px solid ${col}`,
                background:isDone?`${col}20`:isActive?`${col}14`:"rgba(255,255,255,.03)",
                display:"flex",alignItems:"center",justifyContent:"center",position:"relative",transition:"all .3s",
                ...(isActive?{animation:"pulse-ring 2.5s ease-in-out infinite",color:col,boxShadow:`0 0 0 3px ${col}28,0 0 18px ${col}35`}:{}),
                ...(isDone?{boxShadow:`0 0 10px ${col}35`}:{}),
                ...(isBlocked?{boxShadow:`0 0 10px ${C.coral}45`}:{}),
              }}>
                {isDone&&<span style={{fontSize:compact?10:12,color:col,fontWeight:700}}>✓</span>}
                {isActive&&<div style={{width:compact?8:10,height:compact?8:10,borderRadius:"50%",background:col,boxShadow:`0 0 8px ${col}`}}/>}
                {isBlocked&&<span style={{fontSize:compact?10:12,color:col,fontWeight:700}}>✕</span>}
                {s.durum==="bekliyor"&&<span style={{fontSize:compact?9:10,color:"rgba(255,255,255,.22)",fontWeight:600}}>{i+1}</span>}
                {s.fason&&<div style={{position:"absolute",top:-4,right:-4,width:13,height:13,borderRadius:"50%",
                  background:C.lav,border:`2px solid ${C.bg}`,display:"flex",alignItems:"center",
                  justifyContent:"center",fontSize:7,fontWeight:800,color:"#fff"}}>F</div>}
              </div>
              {!compact&&<div style={{textAlign:"center",width:50}}>
                <div style={{fontSize:9,fontWeight:600,lineHeight:1.2,whiteSpace:"nowrap",overflow:"hidden",
                  textOverflow:"ellipsis",maxWidth:50,
                  color:isActive?col:isDone?"rgba(255,255,255,.5)":"rgba(255,255,255,.25)"}}>{s.ad}</div>
              </div>}
              {compact&&<div className="tt" style={{position:"absolute",bottom:"calc(100% + 8px)",left:"50%",
                transform:"translateX(-50%) translateY(4px)",background:"rgba(255,255,255,0.04)",border:`1px solid ${C.border}`,
                borderRadius:8,padding:"4px 9px",fontSize:11,color:C.text,whiteSpace:"nowrap",
                opacity:0,pointerEvents:"none",transition:"all .18s",zIndex:99,boxShadow:"0 8px 20px rgba(0,0,0,.4)"}}>
                {s.ad}
              </div>}
            </div>
          </div>
        );
      })}
      {more>0&&<><div style={{width:18,height:2,background:"rgba(255,255,255,.08)"}}/>
        <div style={{width:32,height:32,borderRadius:"50%",background:"rgba(255,255,255,.04)",
          border:"1px solid rgba(255,255,255,.1)",display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:10,color:"rgba(255,255,255,.28)",fontWeight:600}}>+{more}</div></>}
    </div>
  );
}

// ── MALİYET KARTİ ─────────────────────────────────────────────────────────────
function MaliyetKart({catKey,cat,params,onUpdate,onAdd,onDelete}){
  const [open,setOpen]=useState(true);
  const rows=cat.rows.map(r=>({...r,c:calcRow(r,params.listeProfilFiyat)}));
  const totM=rows.reduce((s,r)=>s+r.c.matrah,0);
  const totK=rows.reduce((s,r)=>s+r.c.kdv,0);
  return(
    <div style={{background:"rgba(255,255,255,0.03)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:`1px solid ${C.border}`,borderRadius:16,overflow:"hidden",
      boxShadow:"0 4px 16px rgba(0,0,0,.25)"}}>
      <div style={{height:3,background:`linear-gradient(90deg,${cat.color},${cat.color}00)`}}/>
      <div className="cat-hdr" role="button" tabIndex={0} onClick={()=>setOpen(p=>!p)}
        onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setOpen(p=>!p);}}}
        style={{display:"flex",alignItems:"center",
        gap:10,padding:"12px 16px",cursor:"pointer",userSelect:"none",
        borderBottom:open?`1px solid ${C.border}`:"none",transition:"opacity .15s"}}>
        <div style={{width:34,height:34,borderRadius:9,background:`${cat.color}14`,border:`1px solid ${cat.color}22`,
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0}}>{cat.icon}</div>
        <div style={{flex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:7}}>
            <span style={{fontSize:9,color:C.muted,fontWeight:700,letterSpacing:1}}>{cat.no}</span>
            <span style={{fontSize:13,fontWeight:700,color:C.text,fontFamily:F}}>{cat.label}</span>
          </div>
          <div style={{fontSize:10,color:C.muted,marginTop:1}}>{cat.rows.length} kalem</div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:9,color:C.muted}}>Matrah</div>
            <div style={{fontSize:14,fontWeight:800,color:cat.color,fontFamily:F}}>{fmt(totM)} ₺</div>
          </div>
          {totK>0&&<div style={{textAlign:"right"}}>
            <div style={{fontSize:9,color:C.muted}}>KDV</div>
            <div style={{fontSize:12,fontWeight:700,color:C.gold,fontFamily:F}}>+{fmt(totK)} ₺</div>
          </div>}
          <span style={{color:C.muted,fontSize:14}}>{open?"▾":"▸"}</span>
        </div>
      </div>
      {open&&<>
        <div style={{display:"grid",gridTemplateColumns:"1fr 55px 50px 78px 48px 44px 74px 62px 28px",
          gap:5,padding:"5px 16px",background:"rgba(255,255,255,.015)",borderBottom:`1px solid ${C.border}`}}>
          {["Malzeme","Spec","Miktar","Birim Fiyat","İsk%","KDV%","Matrah","KDV",""].map((h,i)=>(
            <div key={i} style={{fontSize:9,fontWeight:700,color:C.muted,letterSpacing:.5,
              textTransform:"uppercase",textAlign:i===0?"left":"right"}}>{h}</div>
          ))}
        </div>
        {rows.map((row,ri)=>(
          <div key={row.id} className="row-wrap" style={{display:"grid",
            gridTemplateColumns:"1fr 55px 50px 78px 48px 44px 74px 62px 28px",
            gap:5,padding:"7px 16px",borderBottom:"1px solid rgba(255,255,255,.03)",
            transition:"background .12s",animation:`row-in .2s ${ri*.025}s ease both`}}>
            <input value={row.name} onChange={e=>onUpdate(catKey,row.id,"name",e.target.value)}
              className="inp-name" style={{width:"100%",background:"transparent",border:"1px solid transparent",
                borderRadius:6,color:C.text,fontSize:12,fontFamily:FB,padding:"3px 5px",transition:"all .15s"}}/>
            <input value={row.spec} onChange={e=>onUpdate(catKey,row.id,"spec",e.target.value)}
              className="inp" style={{width:"100%",background:"rgba(255,255,255,.03)",border:`1px solid ${C.border}`,
                borderRadius:6,color:C.sub,fontSize:11,padding:"3px 5px",textAlign:"center",transition:"all .15s"}}/>
            <div style={{display:"flex",justifyContent:"flex-end"}}>
              <input type="number" step={.001} min={0} value={row.qty??""} className="inp"
                onChange={e=>onUpdate(catKey,row.id,"qty",e.target.value===""?0:parseFloat(e.target.value))}
                style={{width:48,background:"rgba(255,255,255,.04)",border:`1px solid ${C.border}`,borderRadius:6,
                  color:C.text,fontSize:12,padding:"3px 5px",textAlign:"right",transition:"all .15s"}}/>
            </div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end"}}>
              {row.priceMode==="liste"
                ?<span style={{fontSize:9,color:C.muted,fontStyle:"italic",textAlign:"right"}}>Liste {fmt(params.listeProfilFiyat)}₺</span>
                :<div style={{position:"relative",display:"inline-flex",alignItems:"center"}}>
                  <input type="number" step={.01} min={0} value={row.manualPrice??""} className="inp"
                    onChange={e=>onUpdate(catKey,row.id,"manualPrice",e.target.value===""?null:parseFloat(e.target.value))}
                    style={{width:68,background:"rgba(255,255,255,.04)",border:`1px solid ${C.border}`,borderRadius:6,
                      color:C.text,fontSize:12,padding:"3px 20px 3px 5px",textAlign:"right",transition:"all .15s"}}/>
                  <span style={{position:"absolute",right:5,fontSize:9,color:C.muted,pointerEvents:"none"}}>₺</span>
                </div>}
            </div>
            {[["discount","%",44,1],["kdv","%",36,1]].map(([f,sfx,w,st])=>(
              <div key={f} style={{display:"flex",justifyContent:"flex-end"}}>
                <div style={{position:"relative",display:"inline-flex",alignItems:"center"}}>
                  <input type="number" step={st} min={0} value={row[f]??""} className="inp"
                    onChange={e=>onUpdate(catKey,row.id,f,e.target.value===""?0:parseFloat(e.target.value))}
                    style={{width:w,background:"rgba(255,255,255,.04)",border:`1px solid ${C.border}`,borderRadius:6,
                      color:C.text,fontSize:12,padding:"3px 16px 3px 5px",textAlign:"right",transition:"all .15s"}}/>
                  <span style={{position:"absolute",right:4,fontSize:9,color:C.muted,pointerEvents:"none"}}>{sfx}</span>
                </div>
              </div>
            ))}
            <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end"}}>
              <span style={{fontSize:12,fontWeight:700,color:cat.color,fontFamily:F}}>{fmt(row.c.matrah)} ₺</span>
            </div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end"}}>
              <span style={{fontSize:11,color:C.muted}}>{row.c.kdv>0?`+${fmt(row.c.kdv)} ₺`:"—"}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
              <button className="del-row" onClick={()=>onDelete(catKey,row.id)}
                style={{width:22,height:22,borderRadius:6,border:`1px solid ${C.border}`,
                  background:"rgba(255,255,255,.03)",color:C.muted,fontSize:13,cursor:"pointer",
                  display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
            </div>
          </div>
        ))}
        <div style={{padding:"8px 16px",borderTop:"1px solid rgba(255,255,255,.04)"}}>
          <button className="add-row" onClick={()=>onAdd(catKey)}
            style={{display:"flex",alignItems:"center",gap:6,background:"rgba(255,255,255,.03)",
              border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 12px",cursor:"pointer",
              color:C.muted,fontSize:12,fontFamily:FB,transition:"all .2s"}}>
            <span style={{fontSize:15,lineHeight:1}}>+</span><span>Kalem Ekle</span>
          </button>
        </div>
        <div style={{display:"flex",justifyContent:"flex-end",gap:12,padding:"9px 16px",
          background:"rgba(255,255,255,.015)",borderTop:`1px solid ${C.border}`}}>
          {[["Matrah",totM,cat.color],["KDV",totK,C.gold],["Toplam",totM+totK,cat.color]].map(([l,v,c],i)=>(
            <div key={i} style={{display:"flex",gap:4,alignItems:"center",
              ...(i===2?{background:`${c}0E`,border:`1px solid ${c}22`,borderRadius:7,padding:"3px 10px"}:{})}}>
              <span style={{fontSize:10,color:C.muted}}>{l}:</span>
              <span style={{fontSize:i===2?13:12,fontWeight:800,color:c,fontFamily:F}}>{fmt(v)} ₺</span>
            </div>
          ))}
        </div>
      </>}
    </div>
  );
}

// ── NAV ───────────────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  {section:"ANA", items:[
    {id:"dashboard",  label:"Genel Bakış",   icon:"◈"},
  ]},
  {section:"TİCARET", items:[
    {id:"musteriler", label:"Müşteriler",     icon:"👥"},
    {id:"siparisler", label:"Siparişler",     icon:"📋"},
    {id:"sevkiyat",   label:"Sevkiyat",       icon:"🚚"},
  ]},
  {section:"ÜRETİM", items:[
    {id:"atolye",     label:"Atölye",         icon:"🏭"},
    {id:"fason_takip",label:"Fason Takip",    icon:"🔗"},
  ]},
  {section:"MALZEME", items:[
    {id:"tedarik",    label:"Tedarik",        icon:"🛒"},
    {id:"stok",       label:"Stok & Depo",    icon:"📦"},
    {id:"urunler",    label:"Ürün Listesi",   icon:"🏷️"},
    {id:"maliyet",    label:"↳ Maliyet",      icon:"",indent:true},
  ]},
  {section:"TANIM", items:[
    {id:"istasyonlar",label:"İstasyonlar",    icon:"⚙️"},
    {id:"calisanlar", label:"Çalışanlar",     icon:"👤"},
    {id:"fason",      label:"Fason Firmalar", icon:"🏭"},
    {id:"genel",      label:"Genel Ayarlar",  icon:"🔧"},
  ]},
];

// ── STORAGE HOOK (top-level) ─────────────────────────────────────────────────
function useStored(key, init) {
  const [val, setVal] = useState(()=>{
    try { const s=localStorage.getItem("atolye_"+key); return s?JSON.parse(s):init; }
    catch { return init; }
  });
  const set = useCallback(v=>{
    setVal(prev=>{
      const next=typeof v==="function"?v(prev):v;
      try{localStorage.setItem("atolye_"+key,JSON.stringify(next));}catch{}
      return next;
    });
  },[key]);
  return [val,set];
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════════════════════════════════════════
export default function App(){
  const [tab,setTab]               = useState("dashboard");
  const [mounted,setMounted]       = useState(false);
  const [time,setTime]             = useState(new Date());

  // Data states
  const [siparisler,setSiparisler]   = useStored("siparisler", INIT_SIPARISLER);
  const [stok,setStok]               = useStored("stok",       INIT_STOK);
  const [hamMaddeler,setHamMaddeler] = useStored("hamMadde",   INIT_HAM_MADDE);
  const [yarimamulList,setYM]        = useStored("yarimamul",  INIT_YARI_MAMUL);
  const [hizmetler,setHizmetler]     = useStored("hizmetler",  INIT_HIZMET);
  // sureDkAdet alanı eksik kayıtları INIT ile tamamla (memoized)
  // hizmetlerMerged: localStorage'daki gerçek veriler — INIT boş
  const hizmetlerMerged = hizmetler;
  // urunBomList bridge aşağıda tanımlanıyor
  const [istasyonlar,setIstasyonlar] = useStored("istasyonlar",INIT_ISTASYONLAR);
  const [calisanlar,setCalisanlar]   = useStored("calisanlar", INIT_CALISANLAR);
  const [fasonFirmalar,setFasonFirmalar]= useStored("fason",   INIT_FASON);
  const [urunler,setUrunler]          = useStored("urunler",    INIT_URUNLER); // INIT boş — tamamen senin verilen
  // urunBomList bridge — geriye dönük uyumluluk
  const urunBomList = urunler;
  const setUrunBomList = setUrunler;
  const [maliyetData,setMaliyetData] = useStored("maliyet",    INIT_MALIYET);
  const [receteler,setReceteler]     = useStored("receteler",  INIT_RECETELER);
  const [aktifUrun,setAktifUrun]     = useState("u1");
  const [malParams,setMalParams]     = useStored("malParams",  INIT_PARAMS);
  const [malTab,setMalTab]           = useState("kartlar");
  const [genelAyar,setGenelAyar]     = useStored("genelAyar",  {firmaAd:"Atölye OS",vergNo:"",tel:"",adres:"",notlar:""});
  const [stokSekme,setStokSekme]     = useState("hammadde");
  const [tedGorMode,setTedGorMode]   = useState("toplu");
  // Tedarik sekmesi modalleri — hook kuralı gereği IIFE dışında
  const [tedarikSiparisModal, setTedarikSiparisModal] = useState(null);
  const [tedarikGirisModal,   setTedarikGirisModal]   = useState(null);
  // Yeni modüller
  const [musteriler,   setMusteriler]  = useStored("musteriler",  []);
  const [sevkiyatlar,  setSevkiyatlar] = useStored("sevkiyatlar", []);
  const [fasonIsler,   setFasonIsler]  = useStored("fasonIsler",  []);
  const [tedarikSiparisleri, setTedarikSiparisleri] = useStored("tedarikSiparisleri", []);
  const [nakliyeKayitlari, setNakliyeKayitlari] = useStored("nakliyeKayitlari", []);
  const [uretimEmirleriRaw,setUretimEmirleri] = useStored("uretimEmirleri", []);
  // localStorage'daki eski demo verileri otomatik temizle
  const uretimEmirleri = uretimEmirleriRaw.filter(e=>!e.id?.startsWith("ue-demo"));

  // eksikMalzemeYenidenHesapla: engine'e taşındı — eksikMalzemeleriHesapla kullanılıyor
  const eksikMalzemeYenidenHesapla = (ue, allHam, allYM, allUrun) => eksikMalzemeleriHesapla(ue, allHam, allYM, allUrun);
  const [atolyeTab,setAtölyeTab]    = useState("kanban");
  const [aktifUE,setAktifUE]        = useState(null);
  const [atolyeSipNo,setAtolyeSipNo] = useState(null); // null=ürün bazlı, "SP-XXX"=sipariş tümü görünümü
  const [atolyeTick,setAtölyeTick]  = useState(0); // Saniye sayacı için

  // Modal states
  const [modal,setModal]           = useState(null); // {type, data}
  const [expSiparis,setExpSiparis] = useState(null);

  // Atölye saniye sayacı
  useEffect(()=>{
    const t = setInterval(()=>setAtölyeTick(x=>x+1), 1000);
    return ()=>clearInterval(t);
  },[]);

  // Eski / kullanılmayan localStorage key'lerini temizle (bir kez çalışır)
  useEffect(()=>{
    const eskiKeyler = ["atolye_receteler","atolye_maliyet","atolye_stok"];
    eskiKeyler.forEach(k=>{
      if(localStorage.getItem(k)) {
        // Sadece boş/gereksiz olanları sil
        try {
          const v = JSON.parse(localStorage.getItem(k));
          const bosmu = !v || (Array.isArray(v) && v.length===0) || (typeof v==="object" && Object.keys(v).length===0);
          if(bosmu) localStorage.removeItem(k);
        } catch { localStorage.removeItem(k); }
      }
    });
  },[]);

  useEffect(()=>{
    const t=setTimeout(()=>setMounted(true),80);
    return()=>clearTimeout(t);
  },[]);
  useEffect(()=>{const t=setInterval(()=>{
    const now=new Date();
    setTime(prev=>prev.getMinutes()!==now.getMinutes()?now:prev);
  },1000);return()=>clearInterval(t);},[]);

  const hh=String(time.getHours()).padStart(2,"0");
  const mm2=String(time.getMinutes()).padStart(2,"0");

  // ── Maliyet handlers ──
  const malUpdate=useCallback((catKey,rowId,field,value)=>{
    setMaliyetData(p=>({...p,[catKey]:{...p[catKey],rows:(p[catKey]?.rows||[]).map(r=>r.id===rowId?{...r,[field]:value}:r)}}));
  },[]);
  const malAdd=useCallback((catKey)=>{
    setMaliyetData(p=>({...p,[catKey]:{...p[catKey],
      rows:[...(p[catKey]?.rows||[]),{id:uid(),name:"Yeni Kalem",spec:"",qty:1,unit:"adet",priceMode:"sabit",manualPrice:0,discount:0,kdv:20}]}}));
  },[]);
  const malDel=useCallback((catKey,rowId)=>{
    setMaliyetData(p=>({...p,[catKey]:{...p[catKey],rows:(p[catKey]?.rows||[]).filter(r=>r.id!==rowId)}}));
  },[]);

  // ── BOM tabanlı maliyet hesabı (aktif ürüne göre) ────────────────────────────
  // aktifUrun geçersizse otomatik ilk ürüne düş
  // aktifUrun geçersizse (silindi veya hiç set edilmedi) ilk ürüne otomatik geç
  const aktifUrunObj = urunler.find(x=>x.id===aktifUrun) || urunler[0] || null;
  // Sync: aktifUrun uyumsuzsa düzelt
  if(aktifUrunObj && aktifUrunObj.id !== aktifUrun) {
    // setTimeout: render sırasında state set etmeyi önle
    setTimeout(()=>setAktifUrun(aktifUrunObj.id),0);
  }
  const aktifBom = aktifUrunObj?.bom || [];
  const tumStokKalemler = useMemo(()=>[...hamMaddeler,...yarimamulList,...hizmetlerMerged],[hamMaddeler,yarimamulList,hizmetlerMerged]);

  // Her BOM satırı için zenginleştirilmiş veri (memoized)
  const bomZengin = useMemo(()=>aktifBom.map(b=>{
    // Engine bomKalemMaliyet kullanılıyor
    const kalem = tumStokKalemler.find(x=>x.id===b.kalemId)
               || (b.tip==="hizmet" ? hizmetlerMerged.find(x=>x.id===b.kalemId) : null);
    if(!kalem) return {...b,kalem:null,matrah:0,kdvTutar:0,kdvDahil:0};
    const kdvDahil = _bomKalemMaliyet(kalem, b.miktar, b.birim, hamMaddeler, yarimamulList, hizmetlerMerged, 0, b.fireTahmini||0);
    const kdvOran  = (kalem.kdv||0)/100;
    const matrah   = kdvDahil / (1 + kdvOran);
    const kdvTutar = kdvDahil - matrah;
    return {...b, kalem, matrah, kdvTutar, kdvDahil,
      kategori: b.tip==="hammadde"?"Ham Madde"
               :b.tip==="yarimamul"?"Yarı Mamül"
               :kalem.tip==="fason"?"Fason İşçilik"
               :"İç İşçilik",
      renk: b.tip==="hammadde"?C.sky
           :b.tip==="yarimamul"?C.cyan
           :kalem.tip==="fason"?C.lav
           :C.gold
    };
  // aktifUrunObj?.id kullanıyoruz — aktifBom her render yeni ref üretir
  }),[aktifUrunObj?.id,tumStokKalemler,hamMaddeler,yarimamulList,hizmetlerMerged]);

  const totMatrah   = bomZengin.reduce((s,b)=>s+b.matrah,0);
  const totKdv      = bomZengin.reduce((s,b)=>s+b.kdvTutar,0);
  const totKdvDahil = bomZengin.reduce((s,b)=>s+b.kdvDahil,0);

  // Satış hesabı: aktif ürünün satış fiyatını baz al, malParams ile override edilebilir
  const hedefSatisKdvDahil = malParams.targetSaleKdvDahil ?? aktifUrunObj?.satisKdvDahil ?? 0;
  const hedefSatisKdv      = malParams.saleKdv ?? aktifUrunObj?.satisKdv ?? 10;
  const saleNet    = hedefSatisKdvDahil / (1 + hedefSatisKdv/100);
  const brutKar    = saleNet - totMatrah;
  const brutPct    = saleNet>0 ? (brutKar/saleNet)*100 : 0;
  const vergi      = brutKar>0 ? brutKar*(malParams.gelirVergisi??30)/100 : 0;
  const netKar     = brutKar - vergi;
  const netPct     = saleNet>0 ? (netKar/saleNet)*100 : 0;

  // Eski allMalRows — geriye dönük uyumluluk
  const allMalRows = bomZengin;

  // Sipariş progress
  const sipProgress=(sp)=>{
    if(!sp.asamalar||sp.asamalar.length===0) return 0;
    const done=sp.asamalar.filter(a=>a.durum==="bitti").length;
    return Math.round((done/sp.asamalar.length)*100);
  };

  // Stok alert
  const stokAlerts=stok.filter(s=>s.miktar<=s.minStok);

  // ── RENDER ────────────────────────────────────────────────────────────────
  return(
    <>
      <style>{CSS}</style>
      <div style={{display:"flex",minHeight:"100vh",background:C.bg,fontFamily:FB,
        opacity:mounted?1:0,transition:"opacity .5s"}}>

        {/* ══ DEEP AMBIENT BACKGROUND ══ */}
        <div style={{position:"fixed",inset:0,zIndex:0,overflow:"hidden",pointerEvents:"none"}}>

          {/* Base — nearly pure black */}
          <div style={{position:"absolute",inset:0,background:"#060608"}}/>

          {/* Ember glow — bottom center, like the burning log in reference */}
          <div style={{position:"absolute",width:800,height:320,borderRadius:"50%",
            bottom:"-8%",left:"50%",transform:"translateX(-50%)",
            background:"radial-gradient(ellipse, rgba(180,70,10,0.12) 0%, rgba(120,40,5,0.06) 40%, transparent 70%)",
            animation:"orb3 35s ease-in-out infinite"}}/>

          {/* Amber warmth — top left */}
          <div style={{position:"absolute",width:600,height:600,borderRadius:"50%",
            top:"-20%",left:"-10%",
            background:"radial-gradient(circle, rgba(200,90,20,0.07) 0%, transparent 55%)",
            animation:"orb1 28s ease-in-out infinite"}}/>

          {/* Cold dark teal — top right, like forest atmosphere */}
          <div style={{position:"absolute",width:500,height:500,borderRadius:"50%",
            top:"-10%",right:"-8%",
            background:"radial-gradient(circle, rgba(20,50,60,0.2) 0%, transparent 60%)",
            animation:"orb2 32s ease-in-out infinite"}}/>

          {/* Subtle noise/grain texture */}
          <div style={{position:"absolute",inset:0,
            backgroundImage:"url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.035'/%3E%3C/svg%3E\")",
            backgroundSize:"256px 256px",opacity:.5}}/>

          {/* Vignette frame — darkens edges like photo */}
          <div style={{position:"absolute",inset:0,
            background:"radial-gradient(ellipse at 50% 40%, transparent 45%, rgba(0,0,0,0.55) 100%)"}}/>

          {/* Micro grid — barely visible */}
          <div style={{position:"absolute",inset:0,
            backgroundImage:"linear-gradient(rgba(255,255,255,0.012) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.012) 1px,transparent 1px)",
            backgroundSize:"52px 52px"}}/>
        </div>

        {/* ══ SIDEBAR ══ */}
        <aside style={{width:236,position:"fixed",top:0,bottom:0,left:0,zIndex:50,
          background:"rgba(6,6,8,0.85)",
          backdropFilter:"blur(28px)",WebkitBackdropFilter:"blur(28px)",
          borderRight:"1px solid rgba(255,255,255,0.055)",
          display:"flex",flexDirection:"column",
          boxShadow:"1px 0 0 rgba(255,255,255,0.03), 4px 0 40px rgba(0,0,0,0.6)"}}>

          {/* Sidebar ember glow at bottom */}
          <div style={{position:"absolute",bottom:"-10%",left:"50%",transform:"translateX(-50%)",
            width:200,height:200,borderRadius:"50%",pointerEvents:"none",
            background:"radial-gradient(circle, rgba(180,70,10,0.08) 0%, transparent 65%)",
            animation:"ember-flicker 4s ease-in-out infinite"}}/>

          {/* Logo */}
          <div style={{padding:"20px 16px 16px",borderBottom:"1px solid rgba(255,255,255,0.05)",position:"relative"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
              <div style={{width:38,height:38,borderRadius:11,
                background:"rgba(200,90,20,0.12)",
                border:"1px solid rgba(200,90,20,0.22)",
                display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,
                boxShadow:"0 0 24px rgba(180,70,10,0.18), inset 0 1px 0 rgba(255,255,255,0.07)",
                animation:"float 6s ease-in-out infinite"}}>🏭</div>
              <div>
                <div style={{fontSize:15,fontWeight:800,fontFamily:F,letterSpacing:-.2,
                  backgroundImage:"linear-gradient(135deg, #EDE8DF 40%, #C8872A)",
                  WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>
                  Atölye OS
                </div>
                <div style={{fontSize:9,color:C.muted,letterSpacing:1.8,textTransform:"uppercase",marginTop:1}}>
                  {genelAyar.firmaAd||"Mobilya Atölyesi"}
                </div>
              </div>
            </div>
            {/* Saat */}
            <div style={{
              background:"rgba(255,255,255,0.025)",
              border:"1px solid rgba(255,255,255,0.06)",
              borderRadius:10,padding:"9px 13px",
              display:"flex",justifyContent:"space-between",alignItems:"center",
              boxShadow:"inset 0 1px 0 rgba(255,255,255,0.03)"}}>
              <span style={{fontSize:21,fontWeight:700,color:C.text,fontFamily:F,letterSpacing:3}}>
                {hh}<span style={{color:"rgba(232,145,74,0.5)",animation:"blink 1s step-end infinite"}}>:</span>{mm2}
              </span>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:10,color:C.cyan,fontWeight:500,letterSpacing:.3}}>{time.toLocaleDateString("tr-TR",{day:"numeric",month:"short"})}</div>
                <div style={{fontSize:9,color:C.muted,marginTop:1}}>{time.toLocaleDateString("tr-TR",{weekday:"long"})}</div>
              </div>
            </div>
          </div>

          {/* KPIs */}
          <div style={{padding:"10px 10px",display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5,
            borderBottom:"1px solid rgba(255,255,255,0.045)"}}>
            {[
              {n:siparisler.filter(s=>s.durum==="uretimde").length,l:"Üretimde",col:C.cyan},
              {n:siparisler.filter(s=>s.durum==="bloke").length,l:"Bloke",col:C.coral},
              {n:stokAlerts.length,l:"Stok⚠",col:C.gold},
            ].map((k,i)=>(
              <div key={i} style={{
                background:"rgba(255,255,255,0.025)",
                border:`1px solid ${k.col}18`,
                borderRadius:9,padding:"7px 0",textAlign:"center",
                boxShadow:`inset 0 0 16px ${k.col}06`}}>
                <div style={{fontSize:17,fontWeight:700,color:k.col,fontFamily:F,
                  textShadow:`0 0 18px ${k.col}55`}}>{k.n}</div>
                <div style={{fontSize:8,color:C.muted,letterSpacing:.5,textTransform:"uppercase"}}>{k.l}</div>
              </div>
            ))}
          </div>

          {/* Nav */}
          <nav style={{padding:"10px 8px",flex:1,overflowY:"auto",position:"relative"}}>
            {NAV_ITEMS.map((sec,si)=>(
              <div key={si} style={{marginBottom:14}}>
                <div style={{fontSize:9,fontWeight:600,color:"rgba(232,145,74,0.35)",letterSpacing:2,
                  textTransform:"uppercase",padding:"0 10px",marginBottom:4}}>{sec.section}</div>
                {sec.items.map((item)=>{
                  const active=tab===item.id;
                  // Dinamik badge hesapları
                  const dinamikBadge = (() => {
                    if(item.id==="siparisler") {
                      const n=siparisler.filter(s=>s.durum!=="tamamlandi"&&s.durum!=="iptal").length;
                      return n>0?n:null;
                    }
                    if(item.id==="tedarik") {
                      const n=tedarikSiparisleri.filter(ts=>ts.durum==="siparis_bekliyor").length;
                      return n>0?n:null;
                    }
                    if(item.id==="sevkiyat") {
                      const n=sevkiyatlar.filter(s=>s.durum==="hazirlanıyor"||s.durum==="bekliyor").length;
                      return n>0?n:null;
                    }
                    if(item.id==="fason_takip") {
                      const n=fasonIsler.filter(f=>f.durum==="gonderildi"||f.durum==="bekliyor").length;
                      return n>0?n:null;
                    }
                    return item.badge||null;
                  })();
                  const dinamikAlert = item.id==="stok"
                    ? hamMaddeler.some(h=>h.miktar<=h.minStok)
                    : false;
                  return(
                    <button key={item.id} className="nav-item" onClick={()=>setTab(item.id)} style={{
                      width:"100%",display:"flex",alignItems:"center",gap:8,
                      padding:`8px ${item.indent?"22px":"12px"}`,
                      borderRadius:8,border:"none",cursor:"pointer",
                      background:active?"rgba(232,145,74,0.07)":"transparent",
                      color:active?C.cyan:"rgba(237,232,223,.35)",
                      fontWeight:active?500:400,fontSize:13,marginBottom:1,
                      transition:"all .18s",textAlign:"left",fontFamily:FB,
                      borderLeft:`2px solid ${active?"rgba(232,145,74,0.7)":"transparent"}`,
                    }}>
                      {item.icon&&<span style={{fontSize:12,width:16,textAlign:"center",flexShrink:0,
                        opacity:active?1:.6,transition:"opacity .2s"}}>{item.icon}</span>}
                      {!item.icon&&<span style={{width:16,flexShrink:0}}/>}
                      <span style={{flex:1}}>{item.label}</span>
                      {dinamikAlert&&<span style={{width:5,height:5,borderRadius:"50%",background:C.coral,
                        animation:"pulse-dot 2s ease-in-out infinite"}}/>}
                      {dinamikBadge&&<span style={{background:"rgba(232,145,74,0.12)",color:C.cyan,
                        borderRadius:20,border:"1px solid rgba(232,145,74,0.2)",
                        padding:"1px 7px",fontSize:9,fontWeight:600}}>{dinamikBadge}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Worker mode btn */}
          <div style={{padding:"10px 10px 18px",borderTop:"1px solid rgba(255,255,255,0.04)"}}>
            <button className="btn-p" style={{width:"100%",
              background:"linear-gradient(135deg, #C8621A, #A04A10)",
              border:"1px solid rgba(200,98,26,0.3)",
              borderRadius:10,padding:"11px",
              color:"rgba(255,235,200,0.95)",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:FB,
              display:"flex",alignItems:"center",justifyContent:"center",gap:8,transition:"all .22s",
              boxShadow:"0 4px 20px rgba(180,70,10,0.22), inset 0 1px 0 rgba(255,255,255,0.1)"}}>
              📱 Çalışan Modu
            </button>
          </div>
        </aside>

        {/* ══ MAIN ══ */}
        <main style={{marginLeft:236,flex:1,padding:"28px 32px",position:"relative",zIndex:10,minHeight:"100vh"}}>

          {/* ─ DASHBOARD ─ */}
          {tab==="dashboard"&&(()=>{
            // Üretim emirleri kanban
            const ueBeklyen = uretimEmirleri.filter(e=>e.durum==="bekliyor");
            const ueUretimde= uretimEmirleri.filter(e=>e.durum==="uretimde");
            const ueTamam   = uretimEmirleri.filter(e=>e.durum==="tamamlandi");
            const bugununTarihi = new Date().toLocaleDateString("tr-TR",{day:"numeric",month:"long",year:"numeric",weekday:"long"});
            return(
            <div style={{animation:"fade-up .4s ease"}}>
              <PageHeader title="Fabrika Kontrol Paneli" sub={bugununTarihi}
                action={<Btn variant="primary" onClick={()=>setModal({type:"yeniUretimEmri",data:{}})}>+ Üretim Emri</Btn>}/>
              {/* KPIs */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:22}}>
                {[
                  {l:"Üretimde",v:ueUretimde.length,u:"emir",col:C.cyan,icon:"🏭",
                    onClick:()=>setTab("atolye")},
                  {l:"Bekleyen",v:ueBeklyen.length,u:"emir",col:C.gold,icon:"⏳",
                    onClick:()=>setTab("atolye")},
                  {l:"Bugün Tamamlanan",v:ueTamam.filter(e=>{
                    const bugun=new Date().toDateString();
                    return e.tamamlanmaTarihi&&new Date(e.tamamlanmaTarihi).toDateString()===bugun;
                  }).length,u:"adet",col:C.mint,icon:"✅"},
                  {l:"Stok Alarmı",v:hamMaddeler.filter(x=>x.miktar<=x.minStok).length,u:"kalem",
                    col:hamMaddeler.filter(x=>x.miktar<=x.minStok).length>0?C.coral:C.mint,icon:"📦",
                    onClick:()=>setTab("stok")},
                  {l:"Aktif Çalışan",v:calisanlar.filter(c=>c.durum==="aktif").length,u:"kişi",col:C.lav,icon:"👷"},
                ].map((k,i)=>(
                  <div key={i} className="card" onClick={k.onClick} style={{
                    background:"rgba(255,255,255,0.028)",
                    backdropFilter:"blur(16px)",WebkitBackdropFilter:"blur(16px)",
                    border:`1px solid ${k.col}18`,
                    borderRadius:14,padding:"16px",
                    boxShadow:`0 8px 32px rgba(0,0,0,.5),inset 0 0 20px ${k.col}05`,
                    transition:"all .25s",animation:`fade-up .4s ${i*.06}s ease both`,
                    cursor:k.onClick?"pointer":"default"}}>
                    <div style={{fontSize:22,marginBottom:8}}>{k.icon}</div>
                    <div style={{fontSize:26,fontWeight:700,color:k.col,fontFamily:F,letterSpacing:-.5,
                      textShadow:`0 0 24px ${k.col}40`}}>
                      {k.v}<span style={{fontSize:11,fontWeight:400,marginLeft:3,color:C.muted}}>{k.u}</span>
                    </div>
                    <div style={{fontSize:11,color:C.muted,marginTop:3}}>{k.l}</div>
                  </div>
                ))}
              </div>
              {/* ── KANBAN + STOK ALARM ikili layout ── */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 280px",gap:14,alignItems:"start"}}>

                {/* KANBAN */}
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                    <span style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:1.5,textTransform:"uppercase"}}>
                      🏭 Üretim Durumu
                    </span>
                    <div style={{flex:1,height:1,background:C.border}}/>
                    <button onClick={()=>setTab("atolye")} style={{fontSize:12,color:C.cyan,background:"none",border:"none",cursor:"pointer"}}>
                      Atölye Görünümü →
                    </button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                    {[
                      {baslik:"⏳ Bekleyen",renk:C.gold,emirler:ueBeklyen},
                      {baslik:"⚙️ Üretimde",renk:C.cyan,emirler:ueUretimde},
                      {baslik:"✅ Tamamlandı",renk:C.mint,emirler:ueTamam.slice(-3).reverse()},
                    ].map(({baslik,renk,emirler})=>(
                      <div key={baslik} style={{background:"rgba(255,255,255,.02)",border:`1px solid ${renk}20`,
                        borderRadius:12,overflow:"hidden"}}>
                        <div style={{padding:"10px 12px",borderBottom:`1px solid ${renk}15`,
                          background:`${renk}08`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <span style={{fontSize:11,fontWeight:700,color:renk}}>{baslik}</span>
                          <span style={{fontSize:11,color:C.muted}}>{emirler.length}</span>
                        </div>
                        <div style={{padding:8,display:"flex",flexDirection:"column",gap:6,minHeight:80}}>
                          {emirler.length===0&&(
                            <div style={{textAlign:"center",color:C.muted,fontSize:11,padding:"20px 0"}}>Boş</div>
                          )}
                          {emirler.map(e=>{
                            const asamaDone=(e.asamalar||[]).filter(a=>a.durum==="bitti").length;
                            const asamaToplam=(e.asamalar||[]).length;
                            const pct=asamaToplam>0?Math.round(asamaDone/asamaToplam*100):0;
                            return(
                              <div key={e.id} onClick={()=>{setAktifUE(e.id);setTab("atolye");}}
                                className="card" style={{background:"rgba(255,255,255,.03)",
                                border:`1px solid ${renk}22`,borderRadius:9,padding:"8px 10px",cursor:"pointer",
                                transition:"all .18s"}}>
                                <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                                  <span style={{fontSize:9,color:renk,fontWeight:700}}>{e.kod}</span>
                                  <span style={{fontSize:9,color:C.muted}}>{e.adet} adet</span>
                                </div>
                                <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:4,
                                  whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{e.urunAd}</div>
                                {asamaToplam>0&&<>
                                  <div style={{background:"rgba(255,255,255,.05)",borderRadius:3,height:3,overflow:"hidden"}}>
                                    <div style={{width:`${pct}%`,height:"100%",background:renk,borderRadius:3,transition:"width .4s"}}/>
                                  </div>
                                  <div style={{fontSize:9,color:C.muted,marginTop:2}}>{asamaDone}/{asamaToplam} aşama · %{pct}</div>
                                </>}
                                {e.termin&&<div style={{fontSize:9,color:C.muted,marginTop:2}}>📅 {e.termin}</div>}
                              </div>
                            );
                          })}
                        </div>
                        {baslik.includes("Bekleyen")&&(
                          <div style={{padding:"6px 8px",borderTop:`1px solid ${C.border}`}}>
                            <button onClick={()=>setModal({type:"yeniUretimEmri",data:{}})}
                              style={{width:"100%",background:`${renk}10`,border:`1px solid ${renk}25`,
                              borderRadius:7,padding:"6px",fontSize:11,color:renk,cursor:"pointer",fontWeight:600}}>
                              + Yeni Emri
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* SAĞ PANEL: Stok Alarmları + Çalışan Durumu */}
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {/* Stok Alarmları */}
                  <div style={{background:"rgba(255,255,255,.02)",border:`1px solid ${C.border}`,borderRadius:12,overflow:"hidden"}}>
                    <div style={{padding:"10px 12px",borderBottom:`1px solid ${C.border}`,
                      display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontSize:11,fontWeight:700,color:C.coral}}>⚠️ Stok Alarmları</span>
                      <button onClick={()=>setTab("stok")} style={{fontSize:10,color:C.cyan,background:"none",border:"none",cursor:"pointer"}}>Tümü →</button>
                    </div>
                    <div style={{padding:8}}>
                      {hamMaddeler.filter(x=>x.miktar<=x.minStok).length===0?(
                        <div style={{textAlign:"center",color:C.mint,fontSize:11,padding:"12px 0"}}>✅ Stok Normal</div>
                      ):hamMaddeler.filter(x=>x.miktar<=x.minStok).slice(0,4).map(s=>(
                        <div key={s.id} style={{padding:"6px 4px",borderBottom:`1px solid ${C.border}`,
                          display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div>
                            <div style={{fontSize:11,color:C.text,fontWeight:500}}>{s.ad}</div>
                            <div style={{fontSize:9,color:C.muted}}>{s.kategori}</div>
                          </div>
                          <div style={{textAlign:"right"}}>
                            <div style={{fontSize:11,fontWeight:700,color:C.coral}}>{s.miktar} {s.birim}</div>
                            <div style={{fontSize:9,color:C.muted}}>min: {s.minStok}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Çalışan Durumu */}
                  <div style={{background:"rgba(255,255,255,.02)",border:`1px solid ${C.border}`,borderRadius:12,overflow:"hidden"}}>
                    <div style={{padding:"10px 12px",borderBottom:`1px solid ${C.border}`}}>
                      <span style={{fontSize:11,fontWeight:700,color:C.lav}}>👷 Çalışanlar</span>
                    </div>
                    <div style={{padding:8}}>
                      {calisanlar.filter(c=>c.durum==="aktif").map(c=>{
                        const aktifGorev = uretimEmirleri.flatMap(e=>(e.asamalar||[]).filter(a=>a.calisan===c.ad&&a.durum==="devam")).slice(0,1)[0];
                        return(
                          <div key={c.id} style={{padding:"6px 4px",display:"flex",alignItems:"center",gap:8,
                            borderBottom:`1px solid ${C.border}`}}>
                            <div style={{width:28,height:28,borderRadius:"50%",background:`${C.lav}18`,
                              border:`1px solid ${C.lav}30`,display:"flex",alignItems:"center",justifyContent:"center",
                              fontSize:10,fontWeight:800,color:C.lav,flexShrink:0}}>
                              {c.ad.split(" ").map(w=>w[0]).join("").slice(0,2)}
                            </div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:11,color:C.text,fontWeight:500}}>{c.ad}</div>
                              <div style={{fontSize:9,color:aktifGorev?C.mint:C.muted,
                                whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                                {aktifGorev?`⚙️ ${aktifGorev.ad}`:"Boşta"}
                              </div>
                            </div>
                            {aktifGorev&&<div style={{width:6,height:6,borderRadius:"50%",background:C.mint,
                              animation:"pulse-dot 2s ease-in-out infinite",flexShrink:0}}/>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            );
          })()}


          {/* ─ ATÖLYE ─ */}
          {tab==="atolye"&&(()=>{
            // ── SİPARİŞ BAZLI GRUPLAMA ──
            // Aktif UE'leri sipariş bazlı grupla
            const sipGrpMap = {};
            uretimEmirleri.filter(e=>e.durum!=="tamamlandi"&&e.durum!=="iptal").forEach(ue=>{
              const key = ue.sipNo||"__bagimsiz__";
              if(!sipGrpMap[key]) sipGrpMap[key]={sipNo:key,ueler:[],sp:siparisler.find(s=>s.id===key)};
              sipGrpMap[key].ueler.push(ue);
            });
            const sipGruplar = Object.values(sipGrpMap);


            // ── YARDIMCI FONKSİYONLAR ──────────────────────────────────────────
            // snToStr / snGoster: global engine fonksiyonu kullanılıyor


            // Üretim emrinin toplam ilerleme yüzdesi
            const ueProgress = (ue) => {
              const asamalar = ue.asamalar||[];
              if(!asamalar.length) return 0;
              const bitti = asamalar.filter(a=>a.durum==="bitti").length;
              return Math.round(bitti/asamalar.length*100);
            };

            // Aktif (devam eden) aşamayı bul
            const aktifAsama = (ue) => (ue.asamalar||[]).find(a=>a.durum==="devam");

            // Renk haritası
            const ASAMA_RENK = {
              "Kesim":C.sky,"Lazer Kesim":C.sky,"Kaynak":C.coral,
              "Boya":"#A78BFA","Statik Boya":"#A78BFA",
              "Süngerleme":C.gold,"Döşeme":C.cyan,"Montaj":C.mint,
              "Paket":"#94A3B8","Paketleme":"#94A3B8","Dikim":"#F472B6",
              "Kumaş Kesim":"#38BDF8","Fason":C.lav
            };
            const aRenk = (ad) => ASAMA_RENK[ad] || "#6B7280";

            // Seçili UE — aktifUE yoksa ve sipariş seçiliyse null dönsün (ikili panel bug fix)
            const ueSecili = aktifUE ? uretimEmirleri.find(e=>e.id===aktifUE) : null;
            const ueGosterilen = ueSecili || (!atolyeSipNo ? (uretimEmirleri.find(e=>e.durum==="uretimde") || uretimEmirleri[0]) : null);

            // Eksik ham madde hesabı: seçili UE veya tüm aktif UE'ler
            const tumAktifHM = {};
            const atolyeYmStok = {}; // Paylaşımlı YM stok
            const hedefUEler = ueGosterilen ? [ueGosterilen] : uretimEmirleri.filter(e=>e.durum!=="tamamlandi"&&e.durum!=="iptal");
            hedefUEler.forEach(ue=>{
              const ur=urunler.find(x=>x.id===ue.urunId);
              if(!ur) return;
              const ml=bomMalzemeListesi(ur,ue.adet||1,hamMaddeler,yarimamulList,urunler,atolyeYmStok);
              ml.forEach(m=>{
                if(!tumAktifHM[m.id]) tumAktifHM[m.id]={...m,kaynakUEler:[],gereken:0};
                tumAktifHM[m.id].gereken+=m.gereken;
                tumAktifHM[m.id].eksik=Math.max(0,tumAktifHM[m.id].gereken-tumAktifHM[m.id].mevcut);
                tumAktifHM[m.id].yeterli=tumAktifHM[m.id].eksik===0;
                tumAktifHM[m.id].kaynakUEler.push(ue.kod);
              });
            });
            const tumEksikHM = Object.values(tumAktifHM).filter(m=>!m.yeterli);

            // Tedarikçi bazlı gruplama
            const tedGrpAtolye = {};
            tumEksikHM.forEach(m=>{
              const hm=hamMaddeler.find(x=>x.id===m.id);
              const ted=hm?.tedarikci||"Belirtilmemiş";
              if(!tedGrpAtolye[ted]) tedGrpAtolye[ted]=[];
              tedGrpAtolye[ted].push({...m,tedarikci:ted});
            });

            // Aşama güncelle + WorkLog entegrasyonu
            const asamaGuncelle = (ueId, asamaIdx, yeniDurum) => {
              const ue = uretimEmirleriRaw.find(e=>e.id===ueId); // raw — filter bypass
              const asama = ue?.asamalar?.[asamaIdx];

              // WorkLog: başlarken aç, biterken kapat
              // asamaKey: asama.id yoksa ueId+index ile tutarlı key üret
              if(asama) {
                const asamaKey = asama.id || ("asama-" + ueId + "-" + asamaIdx);
                if(yeniDurum==="devam") {
                  workLogRepo.ac(ueId, asamaKey, asama.ad, asama.calisan||"—", asama.sureDk||asama.sureAdet||0);
                } else if(yeniDurum==="bitti") {
                  workLogRepo.kapat(ueId, asamaKey);
                }
              }

              setUretimEmirleri(prev => prev.map(e => {
                if(e.id !== ueId) return e;
                const asamalar = e.asamalar.map((a,i) => {
                  if(i === asamaIdx) return {...a, durum:yeniDurum,
                    basladiAt: yeniDurum==="devam" ? new Date().toISOString() : a.basladiAt,
                    tamamlandiAt: yeniDurum==="bitti" ? new Date().toISOString() : undefined
                  };
                  if(i === asamaIdx+1 && yeniDurum==="bitti" && a.durum==="bekliyor") {
                    // Sonraki aşamayı otomatik başlat + WorkLog aç
                    const sonrakiAsama = e.asamalar[i];
                    if(sonrakiAsama) workLogRepo.ac(ueId, sonrakiAsama.id||("asama-"+ueId+"-"+i), sonrakiAsama.ad, sonrakiAsama.calisan||"—", sonrakiAsama.sureDk||0);
                    return {...a, durum:"devam", basladiAt:new Date().toISOString()};
                  }
                  return a;
                });
                const hepBitti = asamalar.every(a=>a.durum==="bitti");
                return {...e, asamalar,
                  durum: e.durum==="bekliyor" ? "uretimde" : hepBitti ? "tamamlandi" : e.durum,
                  baslangicTarihi: e.durum==="bekliyor" ? new Date().toISOString() : e.baslangicTarihi,
                  tamamlanmaTarihi: hepBitti ? new Date().toISOString() : e.tamamlanmaTarihi
                };
              }));
            };

            // ── AKTİF AŞAMA TIMER ──────────────────────────────────────────────
            // tick = atolyeTick (ana bileşen seviyesinde — hook kuralı)
            const gecenSnNow = (isoStr) => isoStr ? Math.floor((Date.now() - new Date(isoStr).getTime())/1000) : 0;
            const AsamaTimer = ({basladiAt}) => {
              const sn = gecenSnNow(basladiAt);
              const dk = Math.floor(sn/60), s = sn%60;
              // atolyeTick referansı render'ı tetikler
              void atolyeTick;
              return <span style={{fontVariantNumeric:"tabular-nums",fontFamily:"monospace",
                color:C.cyan,fontWeight:700,fontSize:13}}>
                {String(dk).padStart(2,"0")}:{String(s).padStart(2,"0")}
              </span>;
            };

            // ── ÜRETİM HATTI SVG GÖRSEL ────────────────────────────────────────
            const HattGorsel = ({ue}) => {
              const asamalar = ue?.asamalar||[];
              if(!asamalar.length) return null;
              const W = 680, H = 110, PAD = 40;
              const adim = (W - PAD*2) / Math.max(asamalar.length-1, 1);
              return (
                <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{overflow:"visible"}}>
                  <defs>
                    <filter id="glow">
                      <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                      <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
                    </filter>
                    <filter id="glow2">
                      <feGaussianBlur stdDeviation="6" result="coloredBlur"/>
                      <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
                    </filter>
                  </defs>
                  {/* Bağlantı çizgisi — arka plan */}
                  <line x1={PAD} y1={H/2} x2={W-PAD} y2={H/2}
                    stroke="rgba(255,255,255,0.06)" strokeWidth={2}/>
                  {/* İlerleme çizgisi */}
                  {asamalar.map((a,i)=>{
                    const x1 = PAD + i*adim;
                    const x2 = PAD + (i+1)*adim;
                    if(a.durum!=="bitti" || i>=asamalar.length-1) return null;
                    const renk = aRenk(a.ad);
                    return <line key={i} x1={x1} y1={H/2} x2={x2} y2={H/2}
                      stroke={renk} strokeWidth={2.5} opacity={0.7}
                      filter="url(#glow)"/>;
                  })}
                  {/* Nokta + etiket */}
                  {asamalar.map((a,i)=>{
                    const x = PAD + i*adim;
                    const renk = aRenk(a.ad);
                    const bitti = a.durum==="bitti";
                    const devam = a.durum==="devam";
                    const r = devam ? 14 : 10;
                    return (
                      <g key={i}>
                        {devam && <>
                          <circle cx={x} cy={H/2} r={22} fill={renk} opacity={0.08}/>
                          <circle cx={x} cy={H/2} r={17} fill={renk} opacity={0.12}/>
                        </>}
                        <circle cx={x} cy={H/2} r={r}
                          fill={bitti?renk:devam?renk:"rgba(255,255,255,0.04)"}
                          stroke={bitti||devam?renk:"rgba(255,255,255,0.15)"}
                          strokeWidth={devam?2.5:1.5}
                          filter={devam?"url(#glow2)":bitti?"url(#glow)":"none"}
                          opacity={bitti?0.9:devam?1:0.5}/>
                        {bitti && <text x={x} y={H/2+1} textAnchor="middle" dominantBaseline="middle"
                          fill="#fff" fontSize={10} fontWeight="bold">✓</text>}
                        {devam && <text x={x} y={H/2+1} textAnchor="middle" dominantBaseline="middle"
                          fill="#fff" fontSize={9}>⚙</text>}
                        <text x={x} y={H/2+(devam?30:26)} textAnchor="middle"
                          fill={bitti||devam?renk:"rgba(255,255,255,0.3)"}
                          fontSize={9} fontWeight={devam?"700":"400"}
                          fontFamily="Montserrat,sans-serif">
                          {a.ad.length>9?a.ad.slice(0,8)+"…":a.ad}
                        </text>
                        {a.fason && <text x={x} y={H/2+(devam?42:38)} textAnchor="middle"
                          fill={C.lav} fontSize={7}>fason</text>}
                      </g>
                    );
                  })}
                  {/* Aktif ok animasyonu */}
                  {asamalar.map((a,i)=>{
                    if(a.durum!=="devam") return null;
                    const x = PAD + i*adim;
                    return <circle key={`pulse-${i}`} cx={x} cy={H/2} r={18}
                      fill="none" stroke={aRenk(a.ad)} strokeWidth={1.5} opacity={0.4}>
                      <animate attributeName="r" values="14;24;14" dur="2s" repeatCount="indefinite"/>
                      <animate attributeName="opacity" values="0.4;0;0.4" dur="2s" repeatCount="indefinite"/>
                    </circle>;
                  })}
                </svg>
              );
            };

            // ── SOL PANEL: EMİR KART ────────────────────────────────────────────
            const EmirKart = ({ue}) => {
              const pct = ueProgress(ue);
              const ak = aktifAsama(ue);
              const renk = ue.durum==="tamamlandi"?C.mint:ue.durum==="uretimde"?C.cyan:C.gold;
              const secili = ue.id === ueGosterilen?.id;
              return (
                <div onClick={()=>setAktifUE(ue.id)} style={{
                  background: secili?"rgba(0,194,160,0.06)":"rgba(255,255,255,0.025)",
                  border:`1px solid ${secili?C.cyan+"60":C.border}`,
                  borderLeft:`3px solid ${renk}`,
                  borderRadius:12, padding:"12px 14px", cursor:"pointer",
                  transition:"all .18s",
                  boxShadow:secili?`0 0 0 1px ${C.cyan}20,0 4px 20px rgba(0,0,0,0.3)`:"none"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                    <div>
                      <div style={{fontSize:9,color:renk,fontWeight:700,letterSpacing:.8,marginBottom:2}}>{ue.kod}</div>
                      <div style={{fontSize:13,fontWeight:700,color:C.text,fontFamily:F,lineHeight:1.2}}>{ue.urunAd}</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:13,fontWeight:800,color:renk,fontFamily:F}}>{ue.adet}<span style={{fontSize:9,fontWeight:400,color:C.muted,marginLeft:2}}>adet</span></div>
                      {ue.termin&&<div style={{fontSize:9,color:C.muted}}>📅 {ue.termin}</div>}
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div style={{background:"rgba(255,255,255,0.05)",borderRadius:3,height:3,overflow:"hidden",marginBottom:4}}>
                    <div style={{width:`${pct}%`,height:"100%",background:`linear-gradient(90deg,${renk},${renk}aa)`,
                      borderRadius:3,transition:"width .5s ease"}}/>
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:9,color:C.muted}}>
                      {(ue.asamalar||[]).filter(a=>a.durum==="bitti").length}/{(ue.asamalar||[]).length} aşama
                    </span>
                    <div style={{display:"flex",gap:4,alignItems:"center"}}>
                      {ak && <span style={{fontSize:9,color:C.cyan,background:`${C.cyan}12`,
                        borderRadius:4,padding:"1px 6px"}}>⚙ {ak.ad}</span>}
                      {ue.durum==="tamamlandi"&&<span style={{fontSize:9,color:C.mint}}>✅</span>}
                      <button onClick={(e)=>{e.stopPropagation();
                        setUretimEmirleri(p=>p.filter(x=>x.id!==ue.id));
                      }} style={{background:"rgba(224,92,92,0.08)",border:"none",borderRadius:4,
                        padding:"2px 6px",fontSize:10,color:C.coral,cursor:"pointer",lineHeight:1}}>
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              );
            };

            // ── AŞAMA KART (detay panel) ────────────────────────────────────────
            const AsamaKart = ({asama, idx, ue}) => {
              const onceki = (ue.asamalar||[])[idx-1];
              const kilitli = idx>0 && onceki && onceki.durum!=="bitti" && asama.durum==="bekliyor";
              const renk = aRenk(asama.ad);
              const devam = asama.durum==="devam";
              const bitti = asama.durum==="bitti";
              // Fason detay bilgileri
              const fasonHz = asama.fason&&asama.hizmetId ? (hizmetler||[]).find(h=>h.id===asama.hizmetId) : null;
              const fasonFirma = fasonHz?.firma || fasonHz?.ad || "";
              // Fason durum: gönderildi mi, geldi mi?
              const fasonDurum = asama.fasonDurum || null; // "gonderildi"|"geldi"|null
              const fasonGonderimAt = asama.fasonGonderimAt || null;
              const fasonGeldiAt = asama.fasonGeldiAt || null;
              // İlgili tedarik siparişi (fason yönlendirmeli)
              const ilgiliFasonSiparis = asama.fason ? tedarikSiparisleri.find(ts=>
                (ts.durum==="fasona_gonderildi"||ts.durum==="fasonda") &&
                ts.fasonYonlendirme?.fasonFirmaId===asama.hizmetId
              ) : null;

              return (
                <div style={{
                  background: bitti?`${renk}06`:devam?`${renk}10`:"rgba(255,255,255,0.02)",
                  border:`1.5px solid ${bitti?renk+"30":devam?renk+"50":C.border}`,
                  borderRadius:12, padding:"12px 16px", opacity:kilitli?0.45:1,
                  transition:"all .2s", position:"relative", overflow:"hidden"}}>
                  {devam && <div style={{position:"absolute",top:0,left:0,right:0,height:2,
                    background:`linear-gradient(90deg,${renk},${renk}60)`,
                    animation:"bar-in .5s ease"}}/>}
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    {/* İkon */}
                    <div style={{width:38,height:38,borderRadius:10,flexShrink:0,
                      background:bitti?`${renk}20`:devam?`${renk}15`:"rgba(255,255,255,0.04)",
                      border:`1.5px solid ${bitti||devam?renk+"60":C.border}`,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:16, filter:devam?`drop-shadow(0 0 6px ${renk})`:"none"}}>
                      {bitti?"✅":devam?"⚙️":asama.fason?"🏭":"○"}
                    </div>
                    {/* Bilgi */}
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                        <span style={{fontSize:13,fontWeight:700,color:bitti?C.muted:C.text,
                          fontFamily:F,textDecoration:bitti?"line-through":"none"}}>{asama.ad}</span>
                        {asama.fason&&<span style={{fontSize:9,background:`${C.lav}15`,color:C.lav,
                          borderRadius:4,padding:"1px 5px",fontWeight:600}}>FASON</span>}
                        {asama.fason&&fasonFirma&&<span style={{fontSize:9,background:`${C.lav}08`,color:C.lav,
                          borderRadius:4,padding:"1px 5px"}}>🏭 {fasonFirma}</span>}
                      </div>
                      <div style={{display:"flex",gap:10,marginTop:3,flexWrap:"wrap"}}>
                        {asama.calisan&&!asama.fason&&<span style={{fontSize:10,color:C.muted}}>👤 {asama.calisan}</span>}
                        {asama.sureDk>0&&!asama.fason&&<span style={{fontSize:10,color:C.muted}}>⏱ ~{snToStr(asama.sureDk)}</span>}
                        {asama.fason&&fasonHz?.sureGun>0&&<span style={{fontSize:10,color:C.gold}}>⏱ ~{fasonHz.sureGun} gün</span>}
                        {asama.fason&&fasonHz?.birimFiyat>0&&<span style={{fontSize:10,color:C.muted}}>💰 {fasonHz.birimFiyat}₺/adet</span>}
                        {devam&&asama.basladiAt&&!asama.fason&&<span style={{fontSize:10,color:C.cyan}}>⏱ <AsamaTimer basladiAt={asama.basladiAt}/></span>}
                        {bitti&&asama.tamamlandiAt&&asama.basladiAt&&(()=>{
                          const sure = Math.floor((new Date(asama.tamamlandiAt)-new Date(asama.basladiAt))/1000);
                          return <span style={{fontSize:10,color:C.mint}}>✓ {snToStr(sure)} sürdü</span>;
                        })()}
                      </div>
                      {/* Fason durum satırı */}
                      {asama.fason&&(fasonGonderimAt||fasonGeldiAt||ilgiliFasonSiparis)&&(
                        <div style={{display:"flex",gap:8,marginTop:4,fontSize:9,flexWrap:"wrap"}}>
                          {fasonGonderimAt&&<span style={{color:C.gold,background:`${C.gold}10`,borderRadius:3,padding:"1px 5px"}}>📤 Gönderildi: {new Date(fasonGonderimAt).toLocaleDateString("tr-TR")}</span>}
                          {fasonGeldiAt&&<span style={{color:C.mint,background:`${C.mint}10`,borderRadius:3,padding:"1px 5px"}}>📥 Geldi: {new Date(fasonGeldiAt).toLocaleDateString("tr-TR")}</span>}
                          {ilgiliFasonSiparis&&!fasonGonderimAt&&<span style={{color:C.sky,background:`${C.sky}10`,borderRadius:3,padding:"1px 5px"}}>🔗 {ilgiliFasonSiparis.id}</span>}
                        </div>
                      )}
                      {/* Kısmi sevkiyat geçmişi */}
                      {asama.fason&&(asama.fasonSevkler||[]).length>0&&(
                        <div style={{marginTop:6,paddingTop:6,borderTop:`1px solid ${C.border}`}}>
                          <div style={{fontSize:9,color:C.muted,marginBottom:4}}>Sevkiyat Geçmişi:</div>
                          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                            {(asama.fasonSevkler||[]).map((s,si)=>(
                              <span key={si} style={{fontSize:9,
                                background:s.tip==="gonderim"?`${C.lav}10`:`${C.mint}10`,
                                color:s.tip==="gonderim"?C.lav:C.mint,
                                borderRadius:4,padding:"2px 6px"}}>
                                {s.tip==="gonderim"?"📤":"📥"} {s.miktar} adet · {new Date(s.tarih).toLocaleDateString("tr-TR")}
                              </span>
                            ))}
                          </div>
                          {/* Progress bar */}
                          {(()=>{
                            const topGond = (asama.fasonSevkler||[]).filter(s=>s.tip==="gonderim").reduce((s2,s3)=>s2+(s3.miktar||0),0);
                            const topGelen = (asama.fasonSevkler||[]).filter(s=>s.tip==="teslim").reduce((s2,s3)=>s2+(s3.miktar||0),0);
                            const toplam = asama.fasonToplamAdet||ue.adet||1;
                            return(
                              <div style={{marginTop:4}}>
                                <div style={{display:"flex",height:4,borderRadius:2,overflow:"hidden",background:"rgba(255,255,255,.06)"}}>
                                  <div style={{width:`${Math.min(100,topGelen/toplam*100)}%`,background:C.mint,borderRadius:2}}/>
                                  <div style={{width:`${Math.min(100,(topGond-topGelen)/toplam*100)}%`,background:C.lav,borderRadius:2,opacity:.5}}/>
                                </div>
                                <div style={{fontSize:8,color:C.muted,marginTop:2}}>
                                  {topGelen}/{topGond} geldi · {toplam} toplam
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                    {/* Butonlar */}
                    <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0}}>
                      {!kilitli && !bitti && !asama.fason && (
                        <button onClick={()=>asamaGuncelle(ue.id, idx, devam?"bitti":"devam")}
                          style={{background:devam?`${renk}20`:"rgba(255,255,255,0.06)",
                            border:`1.5px solid ${devam?renk+"60":C.border}`,
                            borderRadius:9,padding:"9px 16px",fontSize:12,fontWeight:700,
                            color:devam?renk:C.sub,cursor:"pointer",whiteSpace:"nowrap",
                            transition:"all .15s",fontFamily:F,
                            boxShadow:devam?`0 0 12px ${renk}30`:"none"}}>
                          {devam?"✅ Bitti":"▶ Başla"}
                        </button>
                      )}
                      {/* Fason butonları — gönder / geldi + kısmi sevkiyat */}
                      {!kilitli && !bitti && asama.fason && !fasonGonderimAt && (
                        <button onClick={()=>{
                          const toplamAdet = ue.adet||1;
                          const miktar2 = prompt(`📤 Fasona gönderilecek miktar?\n\nToplam: ${toplamAdet} adet\n(Tamamını göndermek için boş bırakın)`,String(toplamAdet));
                          if(miktar2===null) return;
                          const gonderilen = parseInt(miktar2)||toplamAdet;
                          setUretimEmirleri(p=>p.map(e=>e.id!==ue.id?e:{...e,
                            asamalar:e.asamalar.map((a,i)=>i!==idx?a:{...a,
                              durum:"devam",basladiAt:new Date().toISOString(),
                              fasonDurum:"gonderildi",fasonGonderimAt:new Date().toISOString(),
                              fasonToplamAdet:toplamAdet,
                              fasonSevkler:[...(a.fasonSevkler||[]),{
                                id:uid(),tip:"gonderim",miktar:gonderilen,tarih:new Date().toISOString()
                              }],
                            })
                          }));
                        }} style={{background:`${C.lav}15`,border:`1px solid ${C.lav}40`,
                          borderRadius:9,padding:"8px 14px",fontSize:11,fontWeight:700,
                          color:C.lav,cursor:"pointer",whiteSpace:"nowrap"}}>
                          📤 Fasona Gönder
                        </button>
                      )}
                      {asama.fason && fasonGonderimAt && !bitti && (()=>{
                        const sevkler = asama.fasonSevkler||[];
                        const toplamGelen = sevkler.filter(s=>s.tip==="teslim").reduce((s2,s3)=>s2+(s3.miktar||0),0);
                        const toplamGonderilen = sevkler.filter(s=>s.tip==="gonderim").reduce((s2,s3)=>s2+(s3.miktar||0),0);
                        const toplamAdet = asama.fasonToplamAdet||ue.adet||1;
                        const kalanGelecek = toplamGonderilen - toplamGelen;
                        const tumGeldi = toplamGelen >= toplamGonderilen && toplamGonderilen > 0;
                        return(
                          <div style={{display:"flex",flexDirection:"column",gap:4}}>
                            {/* Kısmi sevkiyat progress */}
                            {sevkler.length>0&&(
                              <div style={{fontSize:9,color:C.muted,textAlign:"right",marginBottom:2}}>
                                Gönderilen: <strong style={{color:C.lav}}>{toplamGonderilen}</strong> / 
                                Gelen: <strong style={{color:C.mint}}>{toplamGelen}</strong> / 
                                Toplam: <strong>{toplamAdet}</strong>
                              </div>
                            )}
                            {/* Kısmi teslim al butonu */}
                            {kalanGelecek>0&&(
                              <button onClick={()=>{
                                const miktar3 = prompt(`📥 Fasondan gelen miktar?\n\nBeklenen: ${kalanGelecek} adet\n(Tamamını almak için boş bırakın)`,String(kalanGelecek));
                                if(miktar3===null) return;
                                const gelenMiktar2 = parseInt(miktar3)||kalanGelecek;
                                const yeniSevkler = [...sevkler,{id:uid(),tip:"teslim",miktar:gelenMiktar2,tarih:new Date().toISOString()}];
                                const yeniToplamGelen = toplamGelen + gelenMiktar2;
                                const hepGeldi = yeniToplamGelen >= toplamGonderilen;
                                setUretimEmirleri(p=>p.map(e=>e.id!==ue.id?e:{...e,
                                  asamalar:e.asamalar.map((a,i)=>{
                                    if(i===idx) return {...a,
                                      fasonSevkler:yeniSevkler,
                                      ...(hepGeldi?{durum:"bitti",tamamlandiAt:new Date().toISOString(),fasonDurum:"geldi",fasonGeldiAt:new Date().toISOString()}:{}),
                                    };
                                    if(i===idx+1 && hepGeldi && a.durum==="bekliyor") return {...a,durum:"devam",basladiAt:new Date().toISOString()};
                                    return a;
                                  })
                                }));
                              }} style={{background:`${C.mint}15`,border:`1px solid ${C.mint}40`,
                                borderRadius:9,padding:"7px 12px",fontSize:11,fontWeight:700,
                                color:C.mint,cursor:"pointer",whiteSpace:"nowrap"}}>
                                📥 {kalanGelecek} adet geldi
                              </button>
                            )}
                            {/* Daha gönder butonu (kısmi gönderimlerde) */}
                            {toplamGonderilen<toplamAdet&&(
                              <button onClick={()=>{
                                const kalan = toplamAdet-toplamGonderilen;
                                const miktar4 = prompt(`📤 Ek gönderim miktarı?\n\nKalan: ${kalan} adet`,String(kalan));
                                if(miktar4===null) return;
                                const ekGonderim = parseInt(miktar4)||kalan;
                                setUretimEmirleri(p=>p.map(e=>e.id!==ue.id?e:{...e,
                                  asamalar:e.asamalar.map((a,i)=>i!==idx?a:{...a,
                                    fasonSevkler:[...(a.fasonSevkler||[]),{id:uid(),tip:"gonderim",miktar:ekGonderim,tarih:new Date().toISOString()}],
                                  })
                                }));
                              }} style={{background:`${C.lav}10`,border:`1px solid ${C.lav}25`,
                                borderRadius:7,padding:"5px 10px",fontSize:10,
                                color:C.lav,cursor:"pointer",whiteSpace:"nowrap"}}>
                                📤 +{toplamAdet-toplamGonderilen} daha gönder
                              </button>
                            )}
                            {tumGeldi&&!bitti&&(
                              <span style={{fontSize:9,color:C.mint,textAlign:"center"}}>✅ Tüm partiler geldi</span>
                            )}
                          </div>
                        );
                      })()}
                      )}
                      {bitti && (
                        <button onClick={()=>asamaGuncelle(ue.id, idx, "bekliyor")}
                          style={{background:"rgba(255,255,255,0.03)",border:`1px solid ${C.border}`,
                            borderRadius:8,padding:"5px 10px",fontSize:10,color:C.muted,cursor:"pointer"}}>
                          Geri Al
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            };

            // ── CANLI DURUM PANELI ──────────────────────────────────────────────
            const calisanDurum = calisanlar.map(c=>{
              // Bu çalışan şu an hangi aşamada?
              let aktifIs = null;
              uretimEmirleri.forEach(ue=>{
                (ue.asamalar||[]).forEach(a=>{
                  if(a.durum==="devam" && a.calisan===c.ad) aktifIs = {ue, asama:a};
                });
              });
              return {...c, aktifIs};
            });

            return (
            <div style={{animation:"fade-up .35s ease"}}>

              {/* ── BAŞLIK ── */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:12}}>
                <div>
                  <h1 style={{fontSize:26,fontWeight:800,color:C.text,fontFamily:F,margin:0,letterSpacing:-1}}>
                    🏭 Üretim Hattı
                  </h1>
                  <div style={{fontSize:12,color:C.muted,marginTop:3}}>
                    {uretimEmirleri.filter(e=>e.durum==="uretimde").length} aktif ·{" "}
                    {uretimEmirleri.filter(e=>e.durum==="bekliyor").length} bekliyor ·{" "}
                    {uretimEmirleri.filter(e=>e.durum==="tamamlandi").length} tamamlandı
                  </div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  {uretimEmirleri.length>0&&(
                    <button onClick={()=>{
                      setUretimEmirleri([]);
                    }} style={{background:"rgba(224,92,92,0.08)",border:`1px solid ${C.coral}30`,
                      borderRadius:9,padding:"8px 12px",fontSize:11,color:C.coral,cursor:"pointer"}}>
                      🗑 Tümünü Sil
                    </button>
                  )}
                  <Btn variant="primary" onClick={()=>setModal({type:"yeniUretimEmri",data:{}})}>
                    + Yeni Üretim Emri
                  </Btn>
                </div>
              </div>

              {/* ── ÇALIŞAN DURUM ŞERIDI ── */}
              {calisanDurum.some(c=>c.durum==="aktif") && (
                <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
                  {calisanDurum.filter(c=>c.durum==="aktif").map(c=>{
                    const renk = c.aktifIs ? aRenk(c.aktifIs.asama.ad) : C.muted;
                    return (
                      <div key={c.id} style={{background:c.aktifIs?`${renk}0D`:"rgba(255,255,255,0.02)",
                        border:`1px solid ${c.aktifIs?renk+"30":C.border}`,
                        borderRadius:10,padding:"7px 12px",display:"flex",alignItems:"center",gap:8}}>
                        <div style={{width:8,height:8,borderRadius:"50%",
                          background:c.aktifIs?renk:C.muted,
                          boxShadow:c.aktifIs?`0 0 6px ${renk}`:"none"}}/>
                        <div>
                          <div style={{fontSize:11,fontWeight:600,color:c.aktifIs?C.text:C.muted}}>{c.ad}</div>
                          {c.aktifIs ? (
                            <div style={{fontSize:9,color:renk}}>
                              {c.aktifIs.asama.ad} · <AsamaTimer basladiAt={c.aktifIs.asama.basladiAt}/>
                            </div>
                          ):(
                            <div style={{fontSize:9,color:C.muted}}>Boşta</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {uretimEmirleri.length===0 ? (
                <div style={{background:"rgba(255,255,255,0.02)",border:`1px solid ${C.border}`,
                  borderRadius:20,padding:"80px",textAlign:"center",color:C.muted}}>
                  <div style={{fontSize:48,marginBottom:16}}>🏭</div>
                  <div style={{fontSize:18,fontWeight:700,color:C.sub,fontFamily:F,marginBottom:8}}>Üretim Hattı Boş</div>
                  <div style={{fontSize:13,marginBottom:24}}>İlk üretim emrini oluşturarak başla</div>
                  <Btn variant="primary" onClick={()=>setModal({type:"yeniUretimEmri",data:{}})}>
                    + İlk Üretim Emrini Oluştur
                  </Btn>
                </div>
              ) : (
                <div style={{display:"grid",gridTemplateColumns:"260px 1fr",gap:16,alignItems:"start"}}>

                  {/* ── SOL: EMİR LİSTESİ ── */}
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {/* Filtre sekmecikleri */}
                    <div style={{display:"flex",gap:4,marginBottom:4,flexWrap:"wrap"}}>
                      {[["uretimde","⚙ Aktif",C.cyan],["bekliyor","⏳ Bekliyor",C.gold],["tamamlandi","✅ Bitti",C.mint]].map(([d,l,c])=>{
                        const sayi = uretimEmirleri.filter(e=>e.durum===d).length;
                        return sayi>0 && (
                          <span key={d} style={{fontSize:9,fontWeight:600,color:c,
                            background:`${c}12`,border:`1px solid ${c}25`,
                            borderRadius:20,padding:"2px 8px"}}>
                            {l} {sayi}
                          </span>
                        );
                      })}
                    </div>
                    {/* Sipariş bazlı gruplandırılmış UE listesi */}
                    {sipGruplar.length>0 ? sipGruplar.map(grp=>{
                      const spObj = grp.sp;
                      const isSipSecili = atolyeSipNo===grp.sipNo;
                      const sipToplam = grp.ueler.reduce((s,ue)=>s+(ue.adet||0),0);
                      const durumSay = {bekliyor:0,uretimde:0,tamamlandi:0};
                      grp.ueler.forEach(ue=>{durumSay[ue.durum]=(durumSay[ue.durum]||0)+1;});
                      return(
                        <div key={grp.sipNo} style={{marginBottom:8}}>
                          {/* Sipariş başlık kartı */}
                          <div style={{borderRadius:10,overflow:"hidden",border:`1px solid ${isSipSecili?C.cyan+"50":C.border}`,
                            background:isSipSecili?"rgba(0,194,160,0.04)":"rgba(255,255,255,.02)",transition:"all .18s"}}>
                            {/* Sipariş header */}
                            <div style={{padding:"8px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:6,
                              borderBottom:`1px solid ${C.border}`}}
                              onClick={()=>{setAtolyeSipNo(isSipSecili?null:grp.sipNo);setAktifUE(null);}}>
                              <span style={{fontSize:9,fontWeight:800,color:C.cyan,letterSpacing:.5,minWidth:50}}>
                                {grp.sipNo!=="__bagimsiz__"?grp.sipNo:"Bağımsız"}
                              </span>
                              <span style={{fontSize:9,color:C.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>
                                {spObj?.siparisAdi||spObj?.musteri||""}
                              </span>
                              <span style={{fontSize:10,fontWeight:800,color:C.gold,fontFamily:F}}>{sipToplam}</span>
                              <span style={{fontSize:7,color:C.muted}}>adet</span>
                              <span style={{fontSize:9,color:C.muted,transform:isSipSecili?"rotate(180deg)":"rotate(0)",transition:"transform .2s"}}>▾</span>
                            </div>

                            {/* Kapalıyken durum özeti */}
                            {!isSipSecili&&(
                              <div style={{padding:"4px 10px 6px",display:"flex",gap:4,flexWrap:"wrap"}}>
                                {durumSay.bekliyor>0&&<span style={{fontSize:8,background:C.gold+"15",color:C.gold,borderRadius:3,padding:"1px 5px",fontWeight:600}}>⏳ {durumSay.bekliyor} bekliyor</span>}
                                {durumSay.uretimde>0&&<span style={{fontSize:8,background:C.cyan+"15",color:C.cyan,borderRadius:3,padding:"1px 5px",fontWeight:600}}>🔨 {durumSay.uretimde} üretimde</span>}
                                {durumSay.tamamlandi>0&&<span style={{fontSize:8,background:C.mint+"15",color:C.mint,borderRadius:3,padding:"1px 5px",fontWeight:600}}>✅ {durumSay.tamamlandi}</span>}
                                <span style={{fontSize:8,color:C.muted}}>{grp.ueler.length} ürün</span>
                              </div>
                            )}

                            {/* Sipariş Tümü butonu */}
                            {isSipSecili&&grp.ueler.length>1&&(
                              <div onClick={()=>{setAtolyeSipNo(grp.sipNo);setAktifUE(null);}}
                                style={{padding:"6px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:6,
                                  background:!aktifUE?`${C.lav}12`:"transparent",
                                  borderBottom:`1px solid ${C.border}`}}>
                                <span style={{fontSize:11}}>📦</span>
                                <span style={{fontSize:10,fontWeight:!aktifUE?700:400,color:!aktifUE?C.lav:C.muted}}>
                                  Sipariş Tümü ({grp.ueler.length} ürün)
                                </span>
                              </div>
                            )}

                            {/* UE listesi (sipariş açıkken) */}
                            {isSipSecili&&(
                              <div style={{padding:"4px"}}>
                                {grp.ueler.map(ue=><EmirKart key={ue.id} ue={ue}/>)}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }) : uretimEmirleri.map(ue=><EmirKart key={ue.id} ue={ue}/>)}
                  </div>

                  {/* ── SAĞ: DETAY PANEL ── */}
                  {/* Sipariş Tümü Görünümü */}
                  {atolyeSipNo&&!aktifUE&&(()=>{
                    const grp = sipGruplar.find(g=>g.sipNo===atolyeSipNo);
                    if(!grp) return null;
                    const spObj = grp.sp;
                    // Tüm ürünlerin birleşik ham madde ihtiyacı
                    const birlesikHM = {};
                    const birlesikYmStok = {};
                    grp.ueler.forEach(ue=>{
                      const ur=urunler.find(x=>x.id===ue.urunId);
                      if(!ur) return;
                      const ml=bomMalzemeListesi(ur,ue.adet||1,hamMaddeler,yarimamulList,urunler,birlesikYmStok);
                      ml.forEach(m=>{
                        if(!birlesikHM[m.id]) birlesikHM[m.id]={...m,gereken:0,kaynakUrunler:[]};
                        birlesikHM[m.id].gereken+=m.gereken;
                        birlesikHM[m.id].eksik=Math.max(0,birlesikHM[m.id].gereken-birlesikHM[m.id].mevcut);
                        birlesikHM[m.id].yeterli=birlesikHM[m.id].eksik<=0;
                        birlesikHM[m.id].kaynakUrunler.push(ue.urunAd);
                      });
                    });
                    const birlesikListe = Object.values(birlesikHM);
                    const eksikler = birlesikListe.filter(m=>!m.yeterli);
                    const yeterliler = birlesikListe.filter(m=>m.yeterli);
                    // Tedarikçi bazlı gruplama
                    const tedGrpSip = {};
                    eksikler.forEach(m=>{
                      const hm=hamMaddeler.find(x=>x.id===m.id);
                      const ted=hm?.tedarikci||"Belirtilmemiş";
                      if(!tedGrpSip[ted]) tedGrpSip[ted]=[];
                      tedGrpSip[ted].push({...m,tedarikci:ted});
                    });

                    return(
                      <div style={{display:"flex",flexDirection:"column",gap:12}}>
                        {/* Sipariş Başlık */}
                        <div style={{background:"rgba(255,255,255,0.025)",border:`1px solid ${C.lav}30`,
                          borderRadius:16,overflow:"hidden"}}>
                          <div style={{height:3,background:`linear-gradient(90deg,${C.lav},${C.cyan},${C.gold})`}}/>
                          <div style={{padding:"16px 20px"}}>
                            <div style={{fontSize:10,color:C.lav,fontWeight:700,marginBottom:3}}>📦 SİPARİŞ TÜMÜ · {atolyeSipNo}</div>
                            <div style={{fontSize:20,fontWeight:800,color:C.text,fontFamily:F}}>{spObj?.siparisAdi||spObj?.musteri||atolyeSipNo}</div>
                            <div style={{fontSize:12,color:C.muted,marginTop:2}}>
                              {grp.ueler.length} ürün · {grp.ueler.reduce((s,ue)=>s+(ue.adet||0),0)} toplam adet
                              {spObj?.termin&&` · Termin: ${spObj.termin}`}
                            </div>
                            <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
                              {grp.ueler.map(ue=>(
                                <div key={ue.id} onClick={()=>setAktifUE(ue.id)}
                                  style={{background:`${C.cyan}0A`,border:`1px solid ${C.cyan}20`,borderRadius:8,
                                  padding:"6px 10px",cursor:"pointer",transition:"all .15s"}}>
                                  <div style={{fontSize:11,fontWeight:600,color:C.text}}>{ue.urunAd}</div>
                                  <div style={{fontSize:9,color:C.muted}}>{ue.adet} adet · {ue.kod}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Birleşik Eksik Ham Maddeler */}
                        {eksikler.length>0&&(
                          <div style={{background:`${C.coral}06`,border:`1px solid ${C.coral}20`,borderRadius:12,padding:"14px 18px"}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                              <div style={{fontSize:11,fontWeight:700,color:C.coral,letterSpacing:.5}}>
                                ⚠ EKSİK HAM MADDELER — Sipariş Toplamı ({eksikler.length} kalem)
                              </div>
                              <button onClick={()=>{
                                const yeniTedSip = eksikler.map(m=>{
                                  const hm=hamMaddeler.find(x=>x.id===m.id);
                                  return {
                                    id:"ts-"+Date.now()+"-"+Math.random().toString(36).slice(2,6),
                                    durum:"siparis_bekliyor",olusturmaAt:new Date().toISOString(),
                                    kaynakModul:"uretim",kaynakSipNo:atolyeSipNo,
                                    kalemler:[{hamMaddeId:m.id,ad:m.ad,miktar:m.eksik,birim:m.birim,birimFiyat:hm?.listeFiyat||0}],
                                    tedarikci:hm?.tedarikci||"",
                                  };
                                });
                                setTedarikSiparisleri(p=>[...p,...yeniTedSip]);
                                alert("✅ "+eksikler.length+" kalem tedariğe gönderildi!");
                              }}
                                style={{background:`${C.sky}15`,border:`1px solid ${C.sky}30`,borderRadius:8,
                                padding:"6px 14px",fontSize:11,fontWeight:700,color:C.sky,cursor:"pointer"}}>
                                📦 Toplu Tedariğe Gönder ({eksikler.length})
                              </button>
                            </div>
                            {Object.entries(tedGrpSip).map(([ted,malzList])=>(
                              <div key={ted} style={{marginBottom:8}}>
                                <div style={{fontSize:9,fontWeight:700,color:C.gold,marginBottom:3}}>📦 {ted} ({malzList.length})</div>
                                {malzList.map((m,mi)=>(
                                  <div key={mi} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                                    padding:"5px 10px",marginBottom:2,borderRadius:6,background:"rgba(0,0,0,.15)",fontSize:10}}>
                                    <div style={{flex:1}}>
                                      <span style={{color:C.text,fontWeight:600}}>{m.ad}</span>
                                      {m.kaynakUrunler?.length>0&&<span style={{color:C.muted,marginLeft:6,fontSize:8}}>({[...new Set(m.kaynakUrunler)].join(", ")})</span>}
                                    </div>
                                    <div style={{display:"flex",gap:8,flexShrink:0}}>
                                      <span style={{color:C.muted}}>Stok: {fmt(m.mevcut)}</span>
                                      <span style={{color:C.gold}}>Gerek: {fmt(m.gereken)}</span>
                                      <span style={{color:C.coral,fontWeight:700}}>-{fmt(m.eksik)} {m.birim}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Stokta yeterli */}
                        {yeterliler.length>0&&(
                          <div style={{background:`${C.mint}06`,border:`1px solid ${C.mint}18`,borderRadius:12,padding:"12px 16px"}}>
                            <div style={{fontSize:10,fontWeight:700,color:C.mint,marginBottom:6}}>✅ Stokta Yeterli ({yeterliler.length} kalem)</div>
                            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                              {yeterliler.map(m=>(
                                <span key={m.id} style={{fontSize:9,background:`${C.mint}0C`,border:`1px solid ${C.mint}18`,
                                  borderRadius:4,padding:"2px 7px",color:C.mint}}>
                                  {m.ad}: {fmt(m.gereken)} / stok {fmt(m.mevcut)}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {eksikler.length===0&&birlesikListe.length>0&&(
                          <div style={{background:`${C.mint}08`,border:`1px solid ${C.mint}20`,borderRadius:12,
                            padding:"16px",textAlign:"center",fontSize:13,color:C.mint,fontWeight:600}}>
                            ✅ Tüm malzemeler stokta — üretime hazır!
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Ürün Bazlı Detay */}
                  {ueGosterilen ? (
                    <div style={{display:"flex",flexDirection:"column",gap:12}}>

                      {/* Üst başlık kartı */}
                      <div style={{background:"rgba(255,255,255,0.025)",border:`1px solid ${C.border}`,
                        borderRadius:16,overflow:"hidden"}}>
                        {/* Renk şerit */}
                        <div style={{height:3,background:`linear-gradient(90deg,${C.cyan},${C.lav},${C.mint})`}}/>
                        <div style={{padding:"16px 20px"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12}}>
                            <div>
                              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>{ueGosterilen.kod} · {ueGosterilen.sipNo||"Manuel Emir"}</div>
                              <div style={{fontSize:20,fontWeight:800,color:C.text,fontFamily:F,letterSpacing:-0.5}}>{ueGosterilen.urunAd}</div>
                              <div style={{fontSize:12,color:C.muted,marginTop:2}}>{ueGosterilen.adet} adet{ueGosterilen.termin?` · Termin: ${ueGosterilen.termin}`:""}</div>
                            </div>
                            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                              {/* İlerleme daire */}
                              {(()=>{
                                const pct = ueProgress(ueGosterilen);
                                const r=24, c=2*Math.PI*r, off=c*(1-pct/100);
                                const col = pct===100?C.mint:pct>50?C.cyan:C.gold;
                                return (
                                  <div style={{position:"relative",width:60,height:60,flexShrink:0}}>
                                    <svg width={60} height={60} style={{transform:"rotate(-90deg)"}}>
                                      <circle cx={30} cy={30} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={4}/>
                                      <circle cx={30} cy={30} r={r} fill="none" stroke={col} strokeWidth={4}
                                        strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
                                        style={{transition:"stroke-dashoffset .6s ease",filter:`drop-shadow(0 0 4px ${col})`}}/>
                                    </svg>
                                    <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",
                                      fontSize:12,fontWeight:800,color:col,fontFamily:F}}>{pct}%</div>
                                  </div>
                                );
                              })()}
                              {ueGosterilen.durum==="bekliyor"&&(
                                <button onClick={()=>setUretimEmirleri(p=>p.map(e=>e.id===ueGosterilen.id?{...e,durum:"uretimde",baslangicTarihi:new Date().toISOString()}:e))}
                                  style={{background:`${C.cyan}15`,border:`1px solid ${C.cyan}40`,borderRadius:9,
                                  padding:"9px 18px",fontSize:13,fontWeight:700,color:C.cyan,cursor:"pointer",
                                  boxShadow:`0 0 12px ${C.cyan}20`,fontFamily:F}}>
                                  ▶ Üretime Başla
                                </button>
                              )}
                              {ueGosterilen.durum==="uretimde"&&(ueGosterilen.asamalar||[]).every(a=>a.durum==="bitti")&&(
                                <button onClick={()=>{
                                  const sonuc = uretimTamamlaService(ueGosterilen.id, {
                                    uretimEmirleri: uretimEmirleriRaw, // Raw — filter'lı değil
                                    hamMaddeler, yarimamulList, urunler,
                                    setUretimEmirleri, setHamMaddeler, setUrunler, setYM:setYM
                                  });
                                  if(sonuc.hatalar?.length>0) alert("Hata: "+sonuc.hatalar.join("\n"));
                                  if(sonuc.uyarilar?.length>0) alert("Uyarı:\n"+sonuc.uyarilar.join("\n"));
                                }}
                                  style={{background:`${C.mint}15`,border:`1px solid ${C.mint}40`,borderRadius:9,
                                  padding:"9px 18px",fontSize:13,fontWeight:700,color:C.mint,cursor:"pointer",fontFamily:F}}>
                                  ✅ Tamamlandı — Stok Güncelle
                                </button>
                              )}
                              <button onClick={()=>setModal({type:"ueDetay",data:ueGosterilen})}
                                style={{background:"rgba(255,255,255,0.05)",border:`1px solid ${C.border}`,
                                borderRadius:9,padding:"9px 12px",fontSize:12,color:C.sub,cursor:"pointer"}}>
                                ⚙ Düzenle
                              </button>
                            </div>
                          </div>

                          {/* HAT GÖRSEL */}
                          {(ueGosterilen.asamalar||[]).length>0 && (
                            <div style={{marginTop:16,padding:"12px 0 4px"}}>
                              <HattGorsel ue={ueGosterilen}/>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Eksik Malzeme + Tedarik Durumu */}
                      {(ueGosterilen.eksikMalzemeler||[]).length>0&&(
                        <div style={{background:`${C.coral}06`,border:`1px solid ${C.coral}25`,
                          borderRadius:12,padding:"12px 16px"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                            <div style={{fontSize:10,color:C.coral,fontWeight:700,letterSpacing:1,textTransform:"uppercase"}}>
                              ⚠ Eksik Malzemeler
                            </div>
                            <span style={{fontSize:9,color:C.muted}}>{(ueGosterilen.eksikMalzemeler||[]).length} kalem</span>
                          </div>
                          {(ueGosterilen.eksikMalzemeler||[]).map((m,i)=>(
                            <div key={i} style={{display:"flex",justifyContent:"space-between",
                              alignItems:"center",padding:"5px 8px",marginBottom:4,
                              background:"rgba(0,0,0,0.15)",borderRadius:7}}>
                              <div>
                                <div style={{fontSize:11,color:C.text,fontWeight:600}}>{m.ad}</div>
                                <div style={{fontSize:9,color:C.muted}}>
                                  Stok: {fmt(m.mevcut)} · Gerek: {fmt(m.gereken)} · 
                                  <span style={{color:C.coral}}> -{fmt(m.eksik)} {m.birim} eksik</span>
                                </div>
                              </div>
                              <div style={{display:"flex",gap:4}}>
                                {m.tedarikDurum==="siparis"&&(
                                  <span style={{fontSize:9,background:`${C.gold}15`,color:C.gold,
                                    borderRadius:4,padding:"2px 6px"}}>📦 Sipariş Verildi</span>
                                )}
                                {m.tedarikDurum==="geldi"&&(
                                  <span style={{fontSize:9,background:`${C.mint}15`,color:C.mint,
                                    borderRadius:4,padding:"2px 6px"}}>✅ Geldi</span>
                                )}
                                {(!m.tedarikDurum||m.tedarikDurum==="bekliyor")&&(
                                  <button onClick={()=>setUretimEmirleri(p=>p.map(e=>e.id===ueGosterilen.id?{
                                    ...e,eksikMalzemeler:(e.eksikMalzemeler||[]).map((x,xi)=>xi===i?{...x,tedarikDurum:"siparis"}:x)
                                  }:e))}
                                    style={{fontSize:9,background:`${C.sky}12`,border:`1px solid ${C.sky}25`,
                                    color:C.sky,borderRadius:5,padding:"3px 8px",cursor:"pointer"}}>
                                    Sipariş Ver
                                  </button>
                                )}
                                {m.tedarikDurum==="siparis"&&(
                                  <button onClick={()=>setUretimEmirleri(p=>p.map(e=>e.id===ueGosterilen.id?{
                                    ...e,eksikMalzemeler:(e.eksikMalzemeler||[]).map((x,xi)=>xi===i?{...x,tedarikDurum:"geldi"}:x)
                                  }:e))}
                                    style={{fontSize:9,background:`${C.mint}12`,border:`1px solid ${C.mint}25`,
                                    color:C.mint,borderRadius:5,padding:"3px 8px",cursor:"pointer"}}>
                                    Geldi ✓
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* WorkLog Özeti */}
                      {(()=>{
                        const logs = workLogRepo.byUE(ueGosterilen.id).filter(w=>w.durum==="bitti");
                        if(logs.length===0) return null;
                        const toplamGercek = logs.reduce((s,w)=>s+(w.gerceklesenSure||0),0);
                        const toplamPlan   = logs.reduce((s,w)=>s+(w.planlananSure||0),0);
                        return(
                          <div style={{background:"rgba(255,255,255,0.02)",border:`1px solid ${C.border}`,
                            borderRadius:12,padding:"12px 16px"}}>
                            <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:1,
                              textTransform:"uppercase",marginBottom:8}}>⏱ Süre Analizi</div>
                            <div style={{display:"flex",gap:16,fontSize:11,color:C.muted,flexWrap:"wrap"}}>
                              <span>Planlanan: <strong style={{color:C.gold}}>{snGoster(toplamPlan)}</strong></span>
                              <span>Gerçekleşen: <strong style={{color:toplamGercek<=toplamPlan?C.mint:C.coral}}>{snGoster(toplamGercek)}</strong></span>
                              {toplamPlan>0&&<span>Sapma: <strong style={{color:toplamGercek>toplamPlan?C.coral:C.mint}}>
                                {toplamGercek>toplamPlan?"+":""}{snGoster(Math.abs(toplamGercek-toplamPlan))}
                              </strong></span>}
                            </div>
                          </div>
                        );
                      })()}

                      {/* ── EKSİK HAM MADDELER PANELİ ── */}
                      {tumEksikHM.length>0&&(
                        <div style={{background:`${C.coral}06`,border:`1px solid ${C.coral}20`,borderRadius:12,padding:"12px 16px"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                            <div style={{fontSize:10,fontWeight:700,color:C.coral,letterSpacing:.5}}>
                              ⚠ EKSİK HAM MADDELER — {ueGosterilen?"Bu Ürün":"Tüm Aktif Üretim"} ({tumEksikHM.length} kalem)
                            </div>
                            {tumEksikHM.length>0&&!ueGosterilen?.eksikTedarikGonderildi&&(
                              <button onClick={()=>{
                                // Tedariğe gönder — eksik malzemeleri tedarik siparişlerine ekle
                                const yeniTedSip = tumEksikHM.map(m=>{
                                  const hm=hamMaddeler.find(x=>x.id===m.id);
                                  return {
                                    id:"ts-"+Date.now()+"-"+Math.random().toString(36).slice(2,6),
                                    durum:"siparis_bekliyor",
                                    olusturmaAt:new Date().toISOString(),
                                    kaynakModul:"uretim",
                                    kaynakUEler:m.kaynakUEler||[],
                                    kalemler:[{
                                      hamMaddeId:m.id, ad:m.ad, miktar:m.eksik,
                                      birim:m.birim, birimFiyat:hm?.listeFiyat||0,
                                    }],
                                    tedarikci:hm?.tedarikci||"",
                                  };
                                });
                                setTedarikSiparisleri(p=>[...p,...yeniTedSip]);
                                // UE'lere işaretle
                                setUretimEmirleri(p=>p.map(e=>{
                                  const ilgili=hedefUEler.find(h=>h.id===e.id);
                                  if(!ilgili) return e;
                                  return {...e,eksikTedarikGonderildi:true,eksikMalzemeler:(e.eksikMalzemeler||[]).map(m=>({...m,tedarikDurum:"siparis"}))};
                                }));
                                alert("✅ "+tumEksikHM.length+" kalem tedariğe gönderildi!");
                              }}
                                style={{background:`${C.sky}15`,border:`1px solid ${C.sky}30`,borderRadius:8,
                                padding:"5px 14px",fontSize:11,fontWeight:700,color:C.sky,cursor:"pointer"}}>
                                📦 Tedariğe Gönder ({tumEksikHM.length} kalem)
                              </button>
                            )}
                          </div>
                          {Object.entries(tedGrpAtolye).map(([ted,malzList])=>(
                            <div key={ted} style={{marginBottom:8}}>
                              <div style={{fontSize:9,fontWeight:700,color:C.gold,marginBottom:3}}>📦 {ted} ({malzList.length})</div>
                              {malzList.map((m,mi)=>(
                                <div key={mi} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                                  padding:"4px 8px",marginBottom:2,borderRadius:6,background:"rgba(0,0,0,.15)",fontSize:10}}>
                                  <span style={{color:C.text,fontWeight:600}}>{m.ad}</span>
                                  <div style={{display:"flex",gap:8}}>
                                    <span style={{color:C.muted}}>Stok: {fmt(m.mevcut)}</span>
                                    <span style={{color:C.gold}}>Gerek: {fmt(m.gereken)}</span>
                                    <span style={{color:C.coral,fontWeight:700}}>-{fmt(m.eksik)} {m.birim}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Aşama kartları */}
                      <div style={{background:"rgba(255,255,255,0.02)",border:`1px solid ${C.border}`,
                        borderRadius:16,padding:"16px 20px"}}>
                        <div style={{fontSize:10,color:C.muted,fontWeight:700,letterSpacing:1,
                          textTransform:"uppercase",marginBottom:12}}>Üretim Aşamaları</div>
                        {(ueGosterilen.asamalar||[]).length===0 ? (
                          <div style={{textAlign:"center",color:C.muted,fontSize:12,padding:"20px"}}>
                            <div style={{fontSize:28,marginBottom:8}}>📋</div>
                            Aşama tanımlanmamış.
                            <br/>
                            <button onClick={()=>setModal({type:"ueDetay",data:ueGosterilen})}
                              style={{marginTop:10,background:`${C.cyan}15`,border:`1px solid ${C.cyan}30`,
                              borderRadius:8,padding:"6px 14px",fontSize:12,color:C.cyan,cursor:"pointer"}}>
                              Aşama Ekle →
                            </button>
                          </div>
                        ):(
                          <div style={{display:"flex",flexDirection:"column",gap:8}}>
                            {(ueGosterilen.asamalar||[]).map((asama,ai)=>(
                              <AsamaKart key={asama.id||ai} asama={asama} idx={ai} ue={ueGosterilen}/>
                            ))}
                          </div>
                        )}
                      </div>

                    </div>
                  ):(
                    <div style={{background:"rgba(255,255,255,0.02)",border:`1px solid ${C.border}`,
                      borderRadius:16,padding:"60px",textAlign:"center",color:C.muted}}>
                      <div style={{fontSize:40,marginBottom:12}}>👈</div>
                      <div style={{fontSize:14,color:C.sub}}>Sol taraftan bir üretim emri seç</div>
                    </div>
                  )}
                </div>
              )}
            </div>
            );
          })()}

          {/* ─ SİPARİŞLER ─ */}
          {tab==="siparisler"&&(
            <div style={{animation:"fade-up .35s ease"}}>
              <PageHeader title="Siparişler" sub={`${siparisler.length} sipariş`}
                action={<Btn variant="primary" onClick={()=>setModal({type:"yeniSiparis",data:{}})}>+ Yeni Sipariş</Btn>}/>
              <div style={{display:"flex",gap:6,marginBottom:18,flexWrap:"wrap"}}>
                {[["bekliyor","⏳ Bekliyor",C.gold],["hazir","✅ Hazır",C.mint],["uretimde","🏭 Üretimde",C.cyan],["bloke","🔴 Bloke",C.coral],["sevk_edildi","🚚 Sevk",C.sky],["tamamlandi","✔ Tamam","#888"],["iptal","✕ İptal","#555"]].map(([k,l,c])=>{
                  const n=siparisler.filter(s=>s.durum===k).length;
                  return n>0?(<div key={k} style={{background:c+"0C",border:"1px solid "+c+"20",borderRadius:8,padding:"4px 10px",display:"flex",alignItems:"center",gap:4,cursor:"default"}}>
                    <span style={{fontSize:11,fontWeight:700,color:c}}>{n}</span><span style={{fontSize:10,color:C.muted}}>{l}</span>
                  </div>):null;})}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                {siparisler.map((sp,i)=>{
                  const pct=sipProgress(sp);const d=dm(sp.durum);const kalemler=sp.kalemler||[];const isExp=expSiparis===sp.id;
                  const altGrp={};kalemler.forEach(k=>{const key=k.altMusteriAd||"—";if(!altGrp[key])altGrp[key]=[];altGrp[key].push(k);});
                  // GÜNCEL stok analizi — kaydedilen değerler yerine anlık hesapla
                  const uGrp={};
                  const guncelAnalizler = siparisKalemAnalizleri(kalemler.filter(k=>k.urunId&&k.adet>0), siparisler, sp.id, urunler, hamMaddeler, yarimamulList);
                  const gecerliKalemler2 = kalemler.filter(k=>k.urunId&&k.adet>0);
                  gecerliKalemler2.forEach((k,ki)=>{
                    const a = guncelAnalizler?.[ki];
                    if(!k.urunId) return;
                    if(!uGrp[k.urunId]) uGrp[k.urunId]={id:k.urunId,a:0,s:0,u:0};
                    uGrp[k.urunId].a+=(k.adet||0);
                    uGrp[k.urunId].s+=(a?.stokKarsilanan||0);
                    uGrp[k.urunId].u+=(a?.uretilecek||0);
                  });
                  const spUEler=uretimEmirleri.filter(e=>e.sipNo===sp.id);
                  return(<div key={sp.id} style={{borderRadius:16,overflow:"hidden",transition:"all .25s",border:"1px solid "+(isExp?d.col+"40":"rgba(255,255,255,.04)"),background:isExp?"rgba(255,255,255,.03)":"rgba(255,255,255,.015)",animation:"fade-up .3s "+i*.04+"s ease both"}}>
                    <div style={{height:3,background:"linear-gradient(90deg,"+d.col+","+d.col+"60,transparent)"}}/>
                    <div style={{padding:"16px 20px",cursor:"pointer",display:"grid",gridTemplateColumns:"1fr auto",gap:16,alignItems:"start"}} onClick={()=>setExpSiparis(isExp?null:sp.id)}>
                      <div style={{minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                          <span style={{fontSize:10,fontWeight:800,color:d.col,fontFamily:F,letterSpacing:.5}}>{sp.id}</span>
                          <div style={{height:12,width:1,background:C.border}}/>
                          <Badge label={d.label} color={d.col} small/>
                          {sp.termin&&<span style={{fontSize:10,color:C.muted,marginLeft:"auto"}}>📅 {sp.termin}</span>}
                        </div>
                        <div style={{fontSize:16,fontWeight:800,color:C.text,fontFamily:F,letterSpacing:-.3,marginBottom:2}}>{sp.siparisAdi||sp.urun||"Sipariş"}</div>
                        <div style={{fontSize:12,color:C.sub,display:"flex",alignItems:"center",gap:6}}>
                          <span>{sp.musteri}</span>
                          {Object.keys(altGrp).filter(k=>k!=="—").length>0&&<span style={{fontSize:9,background:C.lav+"12",color:C.lav,borderRadius:4,padding:"1px 6px"}}>{Object.keys(altGrp).filter(k=>k!=="—").length} alt müşteri</span>}
                        </div>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:10}}>
                          {Object.values(uGrp).map(ug=>{const ur=urunler.find(x=>x.id===ug.id);const pB=ug.a>0?Math.round((ug.s/ug.a)*100):0;
                            return(<div key={ug.id} style={{background:"rgba(255,255,255,.03)",borderRadius:8,padding:"6px 10px",border:"1px solid "+C.border,minWidth:120,flex:"0 1 auto"}}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                                <span style={{fontSize:10,fontWeight:700,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:120}}>{ur?.ad||"?"}</span>
                                <span style={{fontSize:11,fontWeight:800,color:C.text,fontFamily:F,marginLeft:8}}>{ug.a}</span>
                              </div>
                              <div style={{height:3,borderRadius:2,background:C.border,marginBottom:3}}><div style={{height:"100%",borderRadius:2,width:pB+"%",background:pB===100?C.mint:C.gold,transition:"width .3s"}}/></div>
                              <div style={{display:"flex",gap:6,fontSize:8}}>{ug.s>0&&<span style={{color:C.mint}}>✓stok {ug.s}</span>}{ug.u>0&&<span style={{color:C.gold}}>🏭üretim {ug.u}</span>}</div>
                            </div>);})}
                        </div>
                      </div>
                      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                        <Ring pct={pct} size={46} col={d.col}/><div style={{fontSize:11,fontWeight:700,color:C.muted,fontFamily:F}}>{sp.adet}</div><div style={{fontSize:8,color:C.muted}}>toplam</div>
                      </div>
                    </div>

                    {isExp&&(()=>{
                      // Stokta olanlar ve eksikler ayrı hesapla
                      const stktOlanlar = Object.values(uGrp).filter(ug=>ug.s>0);
                      const eksikOlanlar = Object.values(uGrp).filter(ug=>ug.u>0);
                      // Eksik ham maddeler — tüm eksik ürünlerin ham madde ihtiyacını topla
                      const eksikHMMap = {};
                      const sipYmStok = {}; // Paylaşımlı YM stok — ürünler arası
                      eksikOlanlar.forEach(ug=>{
                        const ur=urunler.find(x=>x.id===ug.id);
                        if(!ur) return;
                        const ml=bomMalzemeListesi(ur,ug.u,hamMaddeler,yarimamulList,urunler,sipYmStok);
                        ml.forEach(m=>{
                          if(!eksikHMMap[m.id]) {
                            eksikHMMap[m.id]={...m,gereken:0,kaynakUrunler:[]};
                          }
                          eksikHMMap[m.id].gereken+=m.gereken;
                          eksikHMMap[m.id].eksik=Math.max(0,eksikHMMap[m.id].gereken-eksikHMMap[m.id].mevcut);
                          eksikHMMap[m.id].yeterli=eksikHMMap[m.id].eksik===0;
                          eksikHMMap[m.id].kaynakUrunler.push(ur.ad);
                        });
                      });
                      const eksikHMler = Object.values(eksikHMMap).filter(m=>!m.yeterli);

                      return(<div onClick={e=>e.stopPropagation()}>
                      {/* ── STOKTA OLANLAR ── */}
                      {stktOlanlar.length>0&&(
                        <div style={{borderTop:"1px solid "+C.border,padding:"12px 20px",background:C.mint+"06"}}>
                          <div style={{fontSize:10,fontWeight:700,color:C.mint,letterSpacing:.5,marginBottom:8}}>✅ STOKTAN KARŞILANAN ({stktOlanlar.length} ürün)</div>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:6}}>
                            {stktOlanlar.map(ug=>{const ur=urunler.find(x=>x.id===ug.id);
                              return(<div key={ug.id} style={{background:"rgba(255,255,255,.04)",border:"1px solid "+C.mint+"20",borderRadius:9,padding:"8px 12px"}}>
                                <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:2}}>{ur?.ad||"?"}</div>
                                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                                  <span style={{fontSize:9,color:C.mint}}>✓ {ug.s} adet stoktan</span>
                                  <span style={{fontSize:13,fontWeight:800,color:C.mint,fontFamily:F}}>{ug.s}</span>
                                </div>
                              </div>);
                            })}
                          </div>
                        </div>
                      )}

                      {/* ── ÜRETİME GÖNDERİLECEKLER ── */}
                      {eksikOlanlar.length>0&&(
                        <div style={{borderTop:"1px solid "+C.border,padding:"12px 20px",background:C.gold+"06"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                            <div style={{fontSize:10,fontWeight:700,color:C.gold,letterSpacing:.5}}>🏭 ÜRETİLECEK ({eksikOlanlar.length} ürün)</div>
                          </div>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:6}}>
                            {eksikOlanlar.map(ug=>{const ur=urunler.find(x=>x.id===ug.id);
                              return(<div key={ug.id} style={{background:"rgba(255,255,255,.04)",border:"1px solid "+C.gold+"25",borderRadius:9,padding:"8px 12px"}}>
                                <div style={{fontSize:12,fontWeight:600,color:C.text,marginBottom:2}}>{ur?.ad||"?"}</div>
                                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                                  <span style={{fontSize:9,color:C.gold}}>🏭 {ug.u} adet üretim</span>
                                  <span style={{fontSize:13,fontWeight:800,color:C.gold,fontFamily:F}}>{ug.u}</span>
                                </div>
                              </div>);
                            })}
                          </div>
                          {/* Eksik ham maddeler */}
                          {eksikHMler.length>0&&(
                            <div style={{marginTop:10,paddingTop:8,borderTop:"1px solid "+C.border}}>
                              <div style={{fontSize:9,fontWeight:700,color:C.coral,letterSpacing:.5,marginBottom:4}}>⚠ EKSİK HAM MADDELER ({eksikHMler.length})</div>
                              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                                {eksikHMler.slice(0,6).map(m=>(
                                  <span key={m.id} style={{fontSize:9,background:C.coral+"0C",border:"1px solid "+C.coral+"20",
                                    borderRadius:5,padding:"2px 7px",color:C.coral}}>
                                    {m.ad}: -{fmt(m.eksik)} {m.birim}
                                  </span>
                                ))}
                                {eksikHMler.length>6&&<span style={{fontSize:9,color:C.muted}}>+{eksikHMler.length-6} daha</span>}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Alt müşteri detay */}
                      {Object.keys(altGrp).length>1&&(
                        <div style={{borderTop:"1px solid "+C.border,padding:"10px 20px",background:"rgba(0,0,0,.1)"}}>
                          {Object.entries(altGrp).map(([altAd,alts],gi)=>(<div key={altAd} style={{marginBottom:gi<Object.keys(altGrp).length-1?8:0}}>
                            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                              {altAd!=="—"&&<span style={{fontSize:10,fontWeight:700,background:C.lav+"15",color:C.lav,borderRadius:5,padding:"2px 8px"}}>🏪 {altAd}</span>}
                              {altAd==="—"&&<span style={{fontSize:10,color:C.muted,fontWeight:600}}>Genel</span>}
                              <span style={{fontSize:9,color:C.muted}}>{alts.reduce((s,k)=>s+(k.adet||0),0)} adet</span>
                            </div>
                            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                              {alts.map((k,ki)=>{const ur=urunler.find(x=>x.id===k.urunId);return(
                                <span key={ki} style={{fontSize:10,background:"rgba(255,255,255,.03)",border:"1px solid "+C.border,borderRadius:6,padding:"3px 8px",color:C.sub}}>
                                  {ur?.ad||"?"} ×{k.adet}
                                </span>);})}
                            </div>
                          </div>))}
                        </div>
                      )}

                      {sp.notlar&&<div style={{padding:"8px 20px",fontSize:12,color:C.sub,borderTop:"1px solid "+C.border}}>📝 {sp.notlar}</div>}

                      {/* Üretim emirleri */}
                      {spUEler.length>0&&(<div style={{borderTop:"1px solid "+C.border,padding:"10px 20px",background:"rgba(0,0,0,.1)"}}>
                        <div style={{fontSize:10,fontWeight:700,color:C.mint,marginBottom:6}}>✓ Üretim Emirleri ({spUEler.length})</div>
                        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{spUEler.map(ue=>(<span key={ue.id} onClick={()=>{setTab("atolye");setAktifUE(ue.id);}} style={{fontSize:10,color:C.mint,background:C.mint+"10",borderRadius:6,padding:"3px 8px",cursor:"pointer",border:"1px solid "+C.mint+"20"}}>{ue.kod} — {ue.urunAd} ({ue.adet})</span>))}</div>
                      </div>)}

                      {/* Butonlar */}
                      <div style={{display:"flex",gap:8,padding:"12px 20px 16px",flexWrap:"wrap",borderTop:"1px solid "+C.border,background:"rgba(0,0,0,.1)"}}>
                        <button onClick={()=>setModal({type:"siparisDuzenle",data:sp})} style={{background:C.sky+"10",border:"1px solid "+C.sky+"22",borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:600,color:C.sky,cursor:"pointer"}}>✏️ Düzenle</button>
                        <button onClick={()=>setModal({type:"siparisDurum",data:sp})} style={{background:d.col+"12",border:"1px solid "+d.col+"25",borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:600,color:d.col,cursor:"pointer"}}>Durum</button>

                        {spUEler.length===0&&sp.durum!=="tamamlandi"&&sp.durum!=="iptal"&&sp.durum!=="sevk_edildi"&&eksikOlanlar.length>0&&(
                          <button onClick={()=>setModal({type:"topluUEOnizleme",data:sp})} style={{background:"linear-gradient(135deg,"+C.cyan+"30,"+C.gold+"20)",border:"1px solid "+C.cyan+"40",borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:700,color:C.cyan,cursor:"pointer"}}>🏭 Toplu Üretime Gönder ({eksikOlanlar.reduce((s,u)=>s+u.u,0)} adet)</button>
                        )}

                        {sp.durum==="hazir"&&(
                          <button onClick={()=>setSiparisler(p=>p.map(s=>s.id===sp.id?{...s,durum:"sevk_edildi"}:s))}
                            style={{background:C.sky+"12",border:"1px solid "+C.sky+"25",borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:600,color:C.sky,cursor:"pointer"}}>🚚 Sevkiyat</button>
                        )}

                        <button onClick={()=>{setSiparisler(p=>p.filter(x=>x.id!==sp.id));}} style={{background:C.coral+"10",border:"1px solid "+C.coral+"22",borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:600,color:C.coral,cursor:"pointer",marginLeft:"auto"}}>Sil</button>
                      </div>
                    </div>);
                    })()}
                  </div>);
                })}
                {siparisler.length===0&&(<div style={{textAlign:"center",padding:"60px 20px",color:C.muted}}><div style={{fontSize:40,marginBottom:12}}>📋</div><div style={{fontSize:14,marginBottom:8}}>Henüz sipariş yok</div><Btn variant="primary" onClick={()=>setModal({type:"yeniSiparis",data:{}})}>+ İlk Siparişi Oluştur</Btn></div>)}
              </div>
            </div>
          )}

          {/* ─ STOK ─ */}
          {tab==="stok"&&(
            <div style={{animation:"fade-up .35s ease"}}>
              {/* Header */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:18,flexWrap:"wrap",gap:12}}>
                <div>
                  <h1 style={{fontSize:26,fontWeight:800,fontFamily:F,letterSpacing:-.5,margin:"0 0 3px",
                    backgroundImage:`linear-gradient(135deg,${C.text} 50%,${C.cyan})`,
                    WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Stok & Depo</h1>
                  <p style={{color:C.muted,fontSize:13}}>
                    {hamMaddeler.length} ham madde · {yarimamulList.length} yarı mamül · {urunler.length} ürün · {hizmetler.filter(x=>x.tip==="fason").length} fason · {hizmetler.filter(x=>x.tip==="ic").length} işçilik
                    {hamMaddeler.filter(x=>x.miktar<=x.minStok).length>0&&
                      <span style={{color:C.coral,marginLeft:8}}>⚠ {hamMaddeler.filter(x=>x.miktar<=x.minStok).length} alarm</span>}
                  </p>
                </div>
                {stokSekme==="urunbom"?(
                  <Btn onClick={()=>setTab("urunler")}
                    style={{color:C.cyan,border:`1px solid ${C.cyan}30`,background:`${C.cyan}08`}}>
                    → Ürün Listesi'nden Ekle
                  </Btn>
                ):(
                  <Btn variant="primary" onClick={()=>{
                    if(stokSekme==="hammadde")      setModal({type:"yeniStokKalem",data:{tip:"hammadde"}});
                    else if(stokSekme==="yarimamul") setModal({type:"yeniYM",data:{}});
                    else if(stokSekme==="fason")     setModal({type:"yeniFasonHizmet",data:{}});
                    else if(stokSekme==="iscilik")   setModal({type:"yeniIscilikHizmet",data:{}});
                  }}>
                    + {stokSekme==="hammadde"?"Ham Madde"
                      :stokSekme==="yarimamul"?"Yarı Mamül"
                      :stokSekme==="fason"?"Fason Hizmet"
                      :"İşçilik"} Ekle
                  </Btn>
                )}
              </div>

              {/* Sekmeler */}
              <div style={{display:"flex",gap:3,marginBottom:18,background:"rgba(255,255,255,.025)",
                padding:4,borderRadius:12,width:"fit-content",border:`1px solid ${C.border}`}}>
                {[
                  {id:"hammadde", label:"Ham Madde",  icon:"🧱", col:C.sky,  alarm:hamMaddeler.filter(x=>x.miktar<=x.minStok).length},
                  {id:"yarimamul",label:"Yarı Mamül", icon:"⚙️", col:C.cyan, alarm:0},
                  {id:"urunbom",  label:"Ürünler",    icon:"📦", col:C.mint, alarm:0},
                  {id:"fason",    label:"Fason",       icon:"🏭", col:C.lav,  alarm:0},
                  {id:"iscilik",  label:"İşçilik",     icon:"👷", col:C.gold, alarm:0},
                  {id:"hareketler",label:"Stok Geçmişi", icon:"📋", col:C.sub, alarm:0},
                ].map(s=>{
                  const ak=stokSekme===s.id;
                  return(
                    <button key={s.id} className="tab-b" onClick={()=>setStokSekme(s.id)} style={{
                      padding:"8px 14px",borderRadius:9,border:`1px solid ${ak?s.col+"40":"transparent"}`,
                      background:ak?"rgba(255,255,255,.05)":"transparent",
                      color:ak?s.col:C.muted,fontSize:12,fontWeight:ak?600:400,
                      cursor:"pointer",fontFamily:FB,transition:"all .18s",
                      display:"flex",alignItems:"center",gap:5}}>
                      <span style={{fontSize:12}}>{s.icon}</span>{s.label}
                      {s.alarm>0&&<span style={{background:C.coral,color:"#fff",borderRadius:10,
                        padding:"0 5px",fontSize:9,fontWeight:800}}>{s.alarm}</span>}
                    </button>
                  );
                })}
              </div>

              {/* ── HAM MADDE ── */}
              {stokSekme==="hammadde"&&(
                <div>
                  <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
                    {[
                      {l:"Toplam",v:hamMaddeler.length,c:C.sky},
                      {l:"Kritik", v:hamMaddeler.filter(x=>x.miktar<=x.minStok).length,c:C.coral},
                      {l:"Düşük",  v:hamMaddeler.filter(x=>x.miktar<=x.minStok*1.5&&x.miktar>x.minStok).length,c:C.gold},
                      {l:"Normal", v:hamMaddeler.filter(x=>x.miktar>x.minStok*1.5).length,c:C.mint},
                    ].map((k,i)=>(
                      <div key={i} style={{background:"rgba(255,255,255,.03)",border:`1px solid ${k.c}18`,
                        borderRadius:10,padding:"8px 16px",display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:17,fontWeight:700,color:k.c,fontFamily:F}}>{k.v}</span>
                        <span style={{fontSize:11,color:C.muted}}>{k.l}</span>
                      </div>
                    ))}
                  </div>
                  {(()=>{
                  const _rz = hesaplaRezervasyon(uretimEmirleri,urunler,hamMaddeler,yarimamulList);
                  return(
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(230px,1fr))",gap:10}}>
                    {hamMaddeler.map((k,i)=>{
                      const alarm=k.miktar<=k.minStok, dusuk=k.miktar<=k.minStok*1.5&&!alarm;
                      const col=alarm?C.coral:dusuk?C.gold:C.mint;
                      const lbl=alarm?"KRİTİK":dusuk?"DÜŞÜK":"NORMAL";
                      const netMtKart=netFiyat(k.listeFiyat,k.iskonto); // ₺/mt KDV hariç
                      // Liste fiyatı HER ZAMAN ₺/mt — boy sadece stok birimi
                      const net=netMtKart*(1+(k.kdv||0)/100); // ₺/mt KDV dahil
                      const boyUzHm2 = boyUzunlukCmDuzelt(k.boyUzunluk);
                      const birimGoster = k.birim==="boy"
                        ? (boyUzHm2 ? `boy (${boyUzHm2}cm)` : "boy ⚠ uzunluk girilmeli!")
                        : k.birim;
                      // TL/mt gösterimi — listeFiyat her zaman TL/mt
                      const tlMtGoster = k.birimGrup==="uzunluk" && k.listeFiyat>0
                        ? fmt(_netFiyat(k.listeFiyat,k.iskonto||0)*(1+(k.kdv||0)/100),2)+"₺/mt"
                        : null;
                      const pct=Math.min(100,k.minStok>0?(k.miktar/(k.minStok*2))*100:100);
                      return(
                        <div key={k.id} className="card" onClick={()=>setModal({type:"duzenleHam",data:k})}
                          style={{background:"rgba(255,255,255,.03)",backdropFilter:"blur(12px)",
                            border:`1px solid ${col===C.mint?C.border:col+"28"}`,borderRadius:16,
                            overflow:"hidden",transition:"all .22s",cursor:"pointer",
                            animation:`fade-up .3s ${i*.03}s ease both`}}>
                          <div style={{height:2,background:`linear-gradient(90deg,${col},${col}00)`}}/>
                          <div style={{padding:"13px 15px"}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:9,color:C.muted,marginBottom:2}}>{k.kod} · {k.kategori}</div>
                                <div style={{fontSize:13,fontWeight:600,color:C.text,lineHeight:1.3,
                                  whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{k.ad}</div>
                                {k.tedarikci&&<div style={{fontSize:10,color:C.muted,marginTop:1}}>📦 {k.tedarikci}</div>}
                                {/* Tedarik bilgi badge'leri */}
                                {(k.sevkiyatYontemi||k.fasona_gider_mi)&&(
                                  <div style={{display:"flex",gap:3,marginTop:3,flexWrap:"wrap"}}>
                                    {k.sevkiyatYontemi&&k.sevkiyatYontemi!=="tedarikci_getirir"&&(
                                      <span style={{fontSize:8,background:"rgba(232,145,74,.1)",color:"#E8914A",borderRadius:3,padding:"1px 5px"}}>
                                        {k.sevkiyatYontemi==="ben_alirim"?"🏃 Ben":""}
                                        {k.sevkiyatYontemi==="nakliye"?"🚚 Nakliye":""}
                                        {k.sevkiyatYontemi==="kargo"?"📦 Kargo":""}
                                      </span>
                                    )}
                                    {k.fasona_gider_mi&&<span style={{fontSize:8,background:`${C.lav}12`,color:C.lav,borderRadius:3,padding:"1px 5px"}}>🏭 Fasona</span>}
                                    {k.tahminiTeslimGun>0&&<span style={{fontSize:8,background:"rgba(255,255,255,.05)",color:C.muted,borderRadius:3,padding:"1px 5px"}}>⏱ {k.tahminiTeslimGun}g</span>}
                                  </div>
                                )}
                              </div>
                              <Badge label={lbl} color={col} small/>
                            </div>
                            <div style={{display:"flex",alignItems:"baseline",gap:3,marginBottom:2}}>
                              <span style={{fontSize:22,fontWeight:800,color:col,fontFamily:F,
                                textShadow:`0 0 14px ${col}40`}}>{k.miktar}</span>
                              <span style={{fontSize:11,color:C.muted}}>{k.birim}</span>
                              {k.birim==="boy"&&k.boyUzunluk&&<span style={{fontSize:9,color:C.muted}}>({k.boyUzunluk}cm)</span>}
                            </div>
                            {(()=>{
                            const hr=_rz.hammadde[k.id]||0;
                            const kul=Math.max(0,(k.miktar||0)-hr);
                            return hr>0?(
                              <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:4,flexWrap:"wrap"}}>
                                <span style={{fontSize:9,color:"#E8914A",background:"rgba(232,145,74,.12)",borderRadius:4,padding:"1px 6px"}}>🔒 Rezerve: {Number(hr).toFixed(1)} {k.birim}</span>
                                <span style={{fontSize:9,color:C.mint}}>Kullanılabilir: {Number(kul).toFixed(1)}</span>
                              </div>
                            ):null;
                          })()}
                            <div style={{fontSize:9,color:C.muted,marginBottom:8}}>Min: {k.minStok} {k.birim}</div>
                            <div style={{background:"rgba(255,255,255,.05)",borderRadius:3,height:3,overflow:"hidden",marginBottom:10}}>
                              <div style={{width:`${pct}%`,height:"100%",background:col,borderRadius:3,
                                animation:"bar-in 1s ease",boxShadow:`0 0 6px ${col}60`}}/>
                            </div>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                              <div>
                                <div style={{fontSize:9,color:C.muted,textDecoration:"line-through"}}>
                                  {fmt(k.listeFiyat)}₺/mt (KDV hariç)
                                </div>
                                <div style={{fontSize:12,fontWeight:700,color:C.cyan}}>
                                  {fmt(net)}₺/mt
                                  {k.iskonto>0&&<span style={{fontSize:9,color:C.mint}}> (-{k.iskonto}%+KDV{k.kdv}%)</span>}
                                  {!k.iskonto&&k.kdv>0&&<span style={{fontSize:9,color:C.mint}}> (KDV %{k.kdv} dahil)</span>}
                                </div>
                              </div>
                              <button onClick={e=>{e.stopPropagation();setModal({type:"duzenleHam",data:{...k,id:null,kod:k.kod+"-K",ad:k.ad+" - Kopya",miktar:0,_kopya:true}});}}
                                title="Kopyasını oluştur"
                                style={{background:"rgba(255,255,255,.06)",border:`1px solid ${C.border}`,borderRadius:7,
                                  width:26,height:26,fontSize:13,cursor:"pointer",color:C.muted,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s",flexShrink:0}}
                                onMouseEnter={e=>{e.currentTarget.style.background="rgba(232,145,74,.15)";e.currentTarget.style.color=C.cyan;}}
                                onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.06)";e.currentTarget.style.color=C.muted;}}>
                                📋
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  );})()}
                </div>
              )}

              {/* ── YARI MAMÜL ── */}
              {stokSekme==="yarimamul"&&(
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {yarimamulList.map((ym,i)=>{
                    const alarm=ym.miktar<=ym.minStok;
                    const col=alarm?C.coral:C.cyan;
                    const malBom=ym.bom?.reduce((s,b)=>{
                      const liste=[...hamMaddeler,...yarimamulList,...hizmetlerMerged];
                      const k=liste.find(x=>x.id===b.kalemId);
                      if(!k) return s;
                      return s + bomKalemMaliyet(k, b.miktar, b.birim, hamMaddeler, yarimamulList, hizmetlerMerged);
                    },0)||0;
                    const bomAdlari=(ym.bom||[]).slice(0,3).map(b=>{
                      const k=[...hamMaddeler,...yarimamulList,...hizmetlerMerged].find(x=>x.id===b.kalemId);
                      return k?.ad||"?";
                    });
                    return(
                      <div key={ym.id} className="card" onClick={()=>setModal({type:"duzenleYM",data:ym})}
                        style={{background:"rgba(255,255,255,.03)",backdropFilter:"blur(12px)",
                          border:`1px solid ${C.border}`,borderLeft:`3px solid ${col}40`,
                          borderRadius:14,cursor:"pointer",transition:"all .2s",
                          animation:`fade-up .25s ${i*.04}s ease both`}}>
                        <div style={{padding:"13px 16px",display:"flex",alignItems:"center",gap:14}}>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:4,flexWrap:"wrap"}}>
                              <span style={{fontSize:9,color:C.muted}}>{ym.kod}</span>
                              <Badge label={alarm?"KRİTİK":"YM"} color={col} small/>
                            </div>
                            <div style={{fontSize:14,fontWeight:600,color:C.text,fontFamily:F,marginBottom:4}}>{ym.ad}</div>
                            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                              {bomAdlari.map((ad,bi)=>{
                                const b=ym.bom[bi];
                                const tc=b.tip==="hammadde"?C.sky:b.tip==="yarimamul"?C.cyan:C.lav;
                                return(<span key={bi} style={{background:`${tc}0D`,border:`1px solid ${tc}1A`,
                                  borderRadius:6,padding:"2px 7px",fontSize:10,color:tc}}>
                                  {ad.length>16?ad.slice(0,16)+"…":ad} ×{b.miktar}{b.birim}
                                </span>);
                              })}
                              {(ym.bom?.length||0)>3&&<span style={{fontSize:10,color:C.muted}}>+{ym.bom.length-3}</span>}
                            </div>
                          </div>
                          <div style={{textAlign:"right",flexShrink:0,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
                            <div style={{fontSize:22,fontWeight:700,color:col,fontFamily:F}}>{ym.miktar}</div>
                            <div style={{fontSize:11,color:C.muted}}>{ym.birim}</div>
                            {(()=>{const rz=hesaplaRezervasyon(uretimEmirleri,urunler,hamMaddeler,yarimamulList);const yr=rz.yarimamul[ym.id]||0;const kul=Math.max(0,(ym.miktar||0)-yr);return yr>0?(<div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:1}}><span style={{fontSize:8,color:"#E8914A",background:"rgba(232,145,74,.12)",borderRadius:3,padding:"1px 5px"}}>🔒 {Number(yr).toFixed(0)}</span><span style={{fontSize:8,color:C.mint}}>Kul: {Number(kul).toFixed(0)}</span></div>):null;})()}
                            {malBom>0&&<div style={{fontSize:12,fontWeight:600,color:C.cyan,marginTop:3}}>{fmt(malBom)}₺/adet</div>}
                            <button onClick={e=>{e.stopPropagation();setModal({type:"duzenleYM",data:{...ym,id:null,kod:ym.kod+"-K",ad:ym.ad+" - Kopya",miktar:0,_kopya:true,bom:(ym.bom||[]).map(b=>({...b,id:uid()}))}});}}
                              title="Kopyasını oluştur"
                              style={{background:"rgba(255,255,255,.06)",border:`1px solid ${C.border}`,borderRadius:7,
                                width:26,height:26,fontSize:13,cursor:"pointer",color:C.muted,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s"}}
                              onMouseEnter={e=>{e.currentTarget.style.background="rgba(99,202,183,.15)";e.currentTarget.style.color=C.cyan;}}
                              onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.06)";e.currentTarget.style.color=C.muted;}}>
                              📋
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {yarimamulList.length===0&&<div style={{color:C.muted,fontSize:13,padding:"32px",textAlign:"center"}}>Henüz yarı mamül tanımlanmadı</div>}
                </div>
              )}

              {/* ── ÜRÜNLER (BOM) ── */}
              {stokSekme==="urunbom"&&(
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:10}}>
                  {urunler.map((ur,i)=>{
                    const malBom=ur.bom?.reduce((s,b)=>{
                      const liste=[...hamMaddeler,...yarimamulList,...hizmetlerMerged];
                      const k=liste.find(x=>x.id===b.kalemId);
                      if(!k) return s;
                      return s + bomKalemMaliyet(k, b.miktar, b.birim, hamMaddeler, yarimamulList, hizmetlerMerged);
                    },0)||0;
                    const urSaleNet=ur.satisKdvDahil/(1+(ur.satisKdv??10)/100);
                    const kar=urSaleNet-malBom, marj=urSaleNet>0?(kar/urSaleNet)*100:0;
                    return(
                      <div key={ur.id} className="card" onClick={()=>{setAktifUrun(ur.id);setTab("urunler");}}
                        style={{background:"rgba(255,255,255,.03)",backdropFilter:"blur(12px)",
                          border:`1px solid ${C.border}`,borderTop:`2px solid ${C.mint}40`,
                          borderRadius:16,overflow:"hidden",cursor:"pointer",transition:"all .22s",
                          animation:`fade-up .3s ${i*.05}s ease both`}}>
                        <div style={{padding:"14px 15px"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                            <div>
                              <div style={{fontSize:9,color:C.muted,marginBottom:2}}>{ur.kod} · {ur.kategori}</div>
                              <div style={{fontSize:14,fontWeight:600,color:C.text,fontFamily:F}}>{ur.ad}</div>
                            </div>
                            <div style={{textAlign:"right"}}>
                              <div style={{fontSize:18,fontWeight:700,color:C.cyan,fontFamily:F}}>{ur.satisKdvDahil}₺</div>
                              <div style={{fontSize:9,color:C.muted}}>KDV dahil</div>
                            </div>
                          </div>
                          {malBom>0&&(
                            <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap"}}>
                              <span style={{fontSize:11,color:C.coral}}>Maliyet: {fmt(malBom)}₺</span>
                              <span style={{fontSize:11,color:kar>0?C.mint:C.coral}}>Kâr: {fmt(kar)}₺</span>
                              <span style={{fontSize:11,color:marj>20?C.mint:marj>10?C.gold:C.coral}}>%{fmt(marj,1)}</span>
                            </div>
                          )}
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
                            <div style={{display:"flex",gap:5,flexWrap:"wrap",flex:1}}>
                              {(ur.bom||[]).slice(0,3).map(b=>{
                                const k=[...hamMaddeler,...yarimamulList,...hizmetlerMerged].find(x=>x.id===b.kalemId);
                                const tc=b.tip==="hammadde"?C.sky:b.tip==="yarimamul"?C.cyan:C.lav;
                                return(<span key={b.id} style={{background:`${tc}0D`,border:`1px solid ${tc}1A`,
                                  borderRadius:6,padding:"2px 7px",fontSize:10,color:tc}}>
                                  {(k?.ad||"?").slice(0,14)}</span>);
                              })}
                              {(ur.bom?.length||0)>3&&<span style={{fontSize:10,color:C.muted}}>+{ur.bom.length-3}</span>}
                            </div>
                            <button onClick={e=>{e.stopPropagation();setModal({type:"yeniUrun",data:{...ur,id:null,kod:ur.kod+"-K",ad:ur.ad+" - Kopya",miktar:0,_kopya:true,bom:(ur.bom||[]).map(b=>({...b,id:uid()}))}});}}
                              title="Kopyasını oluştur"
                              style={{background:"rgba(255,255,255,.06)",border:`1px solid ${C.border}`,borderRadius:7,
                                width:26,height:26,fontSize:13,cursor:"pointer",color:C.muted,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s",flexShrink:0,marginLeft:6}}
                              onMouseEnter={e=>{e.currentTarget.style.background="rgba(52,211,153,.15)";e.currentTarget.style.color=C.mint;}}
                              onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.06)";e.currentTarget.style.color=C.muted;}}>
                              📋
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {urunler.length===0&&<div style={{color:C.muted,fontSize:13,padding:"32px",textAlign:"center"}}>Henüz ürün tanımlanmadı</div>}
                </div>
              )}

              {/* ── FASON ── */}
              {stokSekme==="fason"&&(
                <div>
                  <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
                    {[
                      {l:"Toplam Fason",   v:hizmetler.filter(x=>x.tip==="fason").length, c:C.lav},
                      {l:"Ortalama Süre",  v:fmt(hizmetler.filter(x=>x.tip==="fason").reduce((s,x)=>s+(x.sureGun||0),0)/Math.max(hizmetler.filter(x=>x.tip==="fason").length,1),1)+" gün", c:C.gold},
                      {l:"Firma Sayısı",   v:[...new Set(hizmetler.filter(x=>x.tip==="fason"&&x.firma).map(x=>x.firma))].length, c:C.cyan},
                    ].map((k,i)=>(
                      <div key={i} style={{background:"rgba(255,255,255,.03)",border:`1px solid ${k.c}18`,
                        borderRadius:10,padding:"8px 16px",display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:15,fontWeight:700,color:k.c,fontFamily:F}}>{k.v}</span>
                        <span style={{fontSize:11,color:C.muted}}>{k.l}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10}}>
                    {hizmetler.filter(x=>x.tip==="fason").map((hz,i)=>(
                      <div key={hz.id} className="card" onClick={()=>setModal({type:"duzenleFasonHizmet",data:hz})}
                        style={{background:"rgba(255,255,255,.03)",backdropFilter:"blur(12px)",
                          border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.lav}50`,
                          borderRadius:14,cursor:"pointer",transition:"all .22s",
                          animation:`fade-up .3s ${i*.04}s ease both`}}>
                        <div style={{padding:"14px 15px"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                            <div>
                              <div style={{fontSize:9,color:C.muted,marginBottom:2}}>{hz.kod}</div>
                              <div style={{fontSize:14,fontWeight:700,color:C.text,fontFamily:F}}>{hz.ad}</div>
                            </div>
                            <Badge label="Fason" color={C.lav} small/>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,
                            background:"rgba(124,92,191,.07)",borderRadius:8,padding:"7px 10px"}}>
                            <span style={{fontSize:15}}>🏭</span>
                            <div>
                              <div style={{fontSize:12,fontWeight:600,color:C.text}}>{hz.firma||"—"}</div>
                              {hz.tel&&<div style={{fontSize:10,color:C.muted}}>{hz.tel}</div>}
                            </div>
                          </div>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                            <div>
                              <span style={{fontSize:18,fontWeight:800,color:C.lav,fontFamily:F}}>{fmt(hz.birimFiyat)}₺</span>
                              <span style={{fontSize:10,color:C.muted}}>/{hz.birim}</span>
                            </div>
                            <span style={{fontSize:10,color:C.muted,background:"rgba(255,255,255,.04)",
                              border:`1px solid ${C.border}`,borderRadius:6,padding:"2px 7px"}}>KDV %{hz.kdv}</span>
                          </div>
                          {hz.sureGun>0&&(
                            <div style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:C.gold}}>
                              <span>⏱</span><span>{hz.sureGun} gün bekleme</span>
                            </div>
                          )}
                          {hz.notlar&&<div style={{fontSize:10,color:C.muted,marginTop:6,borderTop:`1px solid ${C.border}`,paddingTop:6}}>📝 {hz.notlar}</div>}
                        </div>
                      </div>
                    ))}
                    {hizmetler.filter(x=>x.tip==="fason").length===0&&(
                      <div style={{color:C.muted,fontSize:13,padding:"32px",textAlign:"center",gridColumn:"1/-1"}}>
                        Henüz fason hizmet tanımlanmadı
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── İŞÇİLİK ── */}
              {stokSekme==="iscilik"&&(
                <div>
                  <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
                    {[
                      {l:"Toplam İşlem",   v:hizmetlerMerged.filter(x=>x.tip==="ic").length, c:C.gold},
                      {l:"Toplam Süre", v:(()=>{const sn=hizmetlerMerged.filter(x=>x.tip==="ic").reduce((s,x)=>s+(x.sureDkAdet||0),0); return sn>=60?Math.floor(sn/60)+"dk "+(sn%60>0?sn%60+"sn":"")+"/ürün":sn+"sn/ürün";})(), c:C.cyan},
                      {l:"Toplam Maliyet", v:fmt(hizmetlerMerged.filter(x=>x.tip==="ic").reduce((s,x)=>s+(x.birimFiyat||0),0))+"₺/ürün", c:C.mint},
                    ].map((k,i)=>(
                      <div key={i} style={{background:"rgba(255,255,255,.03)",border:`1px solid ${k.c}18`,
                        borderRadius:10,padding:"8px 16px",display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:15,fontWeight:700,color:k.c,fontFamily:F}}>{k.v}</span>
                        <span style={{fontSize:11,color:C.muted}}>{k.l}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {hizmetlerMerged.filter(x=>x.tip==="ic").map((hz,i)=>{
                      const saatUcret=hz.sureDkAdet>0?((hz.birimFiyat||0)/(hz.sureDkAdet/3600)):null;
                      return(
                        <div key={hz.id} className="card" onClick={()=>setModal({type:"duzenleIscilikHizmet",data:hz})}
                          style={{background:"rgba(255,255,255,.03)",backdropFilter:"blur(12px)",
                            border:`1px solid ${C.border}`,borderLeft:`3px solid ${C.gold}50`,
                            borderRadius:14,cursor:"pointer",transition:"all .22s",
                            animation:`fade-up .25s ${i*.04}s ease both`}}>
                          <div style={{padding:"13px 16px",display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:16,alignItems:"center"}}>
                            <div>
                              <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:4}}>
                                <span style={{fontSize:9,color:C.muted}}>{hz.kod}</span>
                                <Badge label="İç İşçilik" color={C.gold} small/>
                              </div>
                              <div style={{fontSize:14,fontWeight:700,color:C.text,fontFamily:F,marginBottom:4}}>{hz.ad}</div>
                              <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                                {hz.istasyon&&(
                                  <span style={{background:"rgba(232,145,74,.1)",border:"1px solid rgba(232,145,74,.2)",
                                    borderRadius:6,padding:"2px 8px",fontSize:10,color:C.cyan}}>
                                    ⚙ {hz.istasyon}
                                  </span>
                                )}
                                {hz.calisan&&(
                                  <span style={{background:"rgba(61,184,138,.08)",border:"1px solid rgba(61,184,138,.2)",
                                    borderRadius:6,padding:"2px 8px",fontSize:10,color:C.mint}}>
                                    👤 {hz.calisan}
                                  </span>
                                )}
                              </div>
                            </div>
                            {hz.sureDkAdet>0&&(
                              <div style={{textAlign:"center",background:"rgba(255,255,255,.04)",
                                border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 12px",minWidth:70}}>
                                <div style={{fontSize:18,fontWeight:700,color:C.gold,fontFamily:F}}>{hz.sureDkAdet>=60?Math.floor(hz.sureDkAdet/60)+"dk"+(hz.sureDkAdet%60>0?" "+hz.sureDkAdet%60+"sn":""):hz.sureDkAdet+"sn"}</div>
                                <div style={{fontSize:9,color:C.muted}}>süre/adet</div>
                              </div>
                            )}
                            {saatUcret&&(
                              <div style={{textAlign:"center",background:"rgba(255,255,255,.04)",
                                border:`1px solid ${C.border}`,borderRadius:10,padding:"8px 12px",minWidth:80}}>
                                <div style={{fontSize:16,fontWeight:700,color:C.sub,fontFamily:F}}>{fmt(saatUcret)}</div>
                                <div style={{fontSize:9,color:C.muted}}>₺/saat</div>
                              </div>
                            )}
                            <div style={{textAlign:"center",background:`${C.gold}0D`,
                              border:`1px solid ${C.gold}22`,borderRadius:10,padding:"8px 12px",minWidth:80}}>
                              <div style={{fontSize:20,fontWeight:800,color:C.gold,fontFamily:F}}>{fmt(hz.birimFiyat)}₺</div>
                              <div style={{fontSize:9,color:C.muted}}>/{hz.birim}</div>
                            </div>
                          </div>
                          {hz.notlar&&<div style={{padding:"0 16px 10px",fontSize:10,color:C.muted}}>📝 {hz.notlar}</div>}
                        </div>
                      );
                    })}
                    {hizmetler.filter(x=>x.tip==="ic").length===0&&(
                      <div style={{color:C.muted,fontSize:13,padding:"32px",textAlign:"center"}}>
                        Henüz işçilik tanımlanmadı
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── STOK HAREKETLERİ ── */}
              {stokSekme==="hareketler"&&(()=>{
                const hareketler = stokHareketiRepo.getAll()
                  .sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
                const TIP_RENK = {
                  satin_alma_girisi:"#4CAF82",
                  uretim_tuketimi:"#E05C5C",
                  bitirmis_urun_giris:"#00C2A0",
                  sevkiyat_cikis:"#E8914A",
                  fasona_gonderim:"#7C5CBF",
                  fasondan_donus:"#3E7BD4",
                  manuel_duzeltme:"#D4A437",
                  fire:"#E05C5C",
                };
                const TIP_LABEL = {
                  satin_alma_girisi:"Satın Alma",
                  uretim_tuketimi:"Üretim Tüketimi",
                  bitirmis_urun_giris:"Ürün Girişi",
                  sevkiyat_cikis:"Sevkiyat",
                  fasona_gonderim:"Fasona Gönderim",
                  fasondan_donus:"Fasondan Dönüş",
                  manuel_duzeltme:"Manuel Düzeltme",
                  fire:"Fire",
                };
                return (
                  <div>
                    <div style={{display:"flex",gap:8,marginBottom:14,alignItems:"center",justifyContent:"space-between"}}>
                      <div style={{fontSize:11,color:C.muted}}>{hareketler.length} hareket kaydı</div>
                      {hareketler.length===0&&(
                        <div style={{color:C.muted,fontSize:12}}>Henüz kayıt yok. Üretim tamamlandıkça ve tedarik gelince burası dolacak.</div>
                      )}
                    </div>
                    {hareketler.slice(0,100).map((h,i)=>{
                      const renk = TIP_RENK[h.hareketTipi]||C.muted;
                      const pozitif = h.miktar>0;
                      return(
                        <div key={h.id||i} style={{background:"rgba(255,255,255,0.02)",
                          border:`1px solid ${C.border}`,borderLeft:`3px solid ${renk}`,
                          borderRadius:9,padding:"8px 12px",marginBottom:6}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                            <div style={{flex:1}}>
                              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                                <span style={{fontSize:9,background:`${renk}15`,color:renk,
                                  borderRadius:4,padding:"1px 6px",fontWeight:700}}>
                                  {TIP_LABEL[h.hareketTipi]||h.hareketTipi}
                                </span>
                                <span style={{fontSize:10,color:C.muted}}>
                                  {h.stokTipi==="hammadde"?"HM":h.stokTipi==="yarimamul"?"YM":"ÜRÜN"}
                                </span>
                              </div>
                              <div style={{fontSize:11,color:C.text,marginBottom:1}}>
                                {/* Stok adını bul */}
                                {h.stokTipi==="hammadde"
                                  ? hamMaddeler.find(x=>x.id===h.stokId)?.ad || h.stokId
                                  : h.stokTipi==="urun"
                                  ? urunler.find(x=>x.id===h.stokId)?.ad || h.stokId
                                  : h.stokId}
                              </div>
                              {h.note&&<div style={{fontSize:9,color:C.muted}}>{h.note}</div>}
                            </div>
                            <div style={{textAlign:"right",flexShrink:0}}>
                              <div style={{fontSize:14,fontWeight:800,color:pozitif?C.mint:C.coral}}>
                                {pozitif?"+":""}{fmt(h.miktar)} {h.birim}
                              </div>
                              <div style={{fontSize:9,color:C.muted}}>
                                {h.oncekiBakiye!=null?`${fmt(h.oncekiBakiye)} → ${fmt(h.sonrakiBakiye)}`:""}{" "}
                                {h.birim}
                              </div>
                              <div style={{fontSize:9,color:C.muted}}>
                                {h.createdAt?new Date(h.createdAt).toLocaleString("tr-TR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):""}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

            </div>
          )}

          {/* ─ TEDARİK ─ */}
          {tab==="tedarik"&&(()=>{
            // ── TEDARİK SEKMESİ — SADECE tedarikSiparisleri VERİSİ ──────────────
            // Atölyeden "Tedariğe Gönder" butonuna basılmadan buraya HİÇBİR ŞEY gelmez.

            // Tedarik görünüm modu — App seviyesinde tanımlı (tedGorMode)
            const tSip = tedarikSiparisleri;

            // Durum kategorileri
            const bekleyenler = tSip.filter(ts=>ts.durum==="siparis_bekliyor");
            const siparisVerilenler = tSip.filter(ts=>ts.durum==="siparis_verildi");
            const yoldakiler = tSip.filter(ts=>ts.durum==="yolda");
            const fasondakiler = tSip.filter(ts=>ts.durum==="fasona_gonderildi"||ts.durum==="fasonda");
            const tamamlananlar = tSip.filter(ts=>ts.durum==="teslim_alindi"||ts.durum==="fasondan_geldi");

            // Toplam kalem sayıları
            const bekleyenKalem = bekleyenler.reduce((s,ts)=>(ts.kalemler||[]).length+s,0);
            const siparisKalem = siparisVerilenler.reduce((s,ts)=>(ts.kalemler||[]).length+s,0);
            const yoldaKalem = yoldakiler.reduce((s,ts)=>(ts.kalemler||[]).length+s,0);
            const fasonKalem = fasondakiler.reduce((s,ts)=>(ts.kalemler||[]).length+s,0);
            const tamamKalem = tamamlananlar.reduce((s,ts)=>(ts.kalemler||[]).length+s,0);

            // Tedarikçi bazlı gruplama (bekleyenler)
            const tedGrupBekleyen = {};
            bekleyenler.forEach(ts=>{
              const ted = ts.tedarikci||"Belirtilmemiş";
              if(!tedGrupBekleyen[ted]) tedGrupBekleyen[ted]={tedarikci:ted,siparisler:[],kalemler:[]};
              tedGrupBekleyen[ted].siparisler.push(ts);
              (ts.kalemler||[]).forEach(k=>tedGrupBekleyen[ted].kalemler.push({...k,tsId:ts.id,sipNo:ts.kaynakSipNo||""}));
            });
            const tedGrupListe = Object.values(tedGrupBekleyen);

            // Ürün bazlı gruplama (bekleyenler — UE kaynağına göre)
            const urunGrup = {};
            bekleyenler.forEach(ts=>{
              const ueId = ts.kaynakUEId||ts.kaynakSipNo||"genel";
              const label = ts.kaynakUEAd||ts.kaynakSipNo||"Genel";
              if(!urunGrup[ueId]) urunGrup[ueId]={label,kalemler:[]};
              (ts.kalemler||[]).forEach(k=>urunGrup[ueId].kalemler.push({...k,tsId:ts.id,tedarikci:ts.tedarikci}));
            });

            // Sipariş bazlı gruplama
            const sipGrup = {};
            bekleyenler.forEach(ts=>{
              const sNo = ts.kaynakSipNo||"Belirtilmemiş";
              if(!sipGrup[sNo]) sipGrup[sNo]={sipNo:sNo,siparisler:[],kalemler:[]};
              sipGrup[sNo].siparisler.push(ts);
              (ts.kalemler||[]).forEach(k=>sipGrup[sNo].kalemler.push({...k,tsId:ts.id,tedarikci:ts.tedarikci}));
            });

            // Durum geçiş helper
            const durumGecis = (tsId, yeniDurum, ekBilgi={}) => {
              setTedarikSiparisleri(p=>p.map(ts=>{
                if(ts.id!==tsId) return ts;
                const now = new Date().toISOString();
                return {...ts, durum:yeniDurum,
                  ...(yeniDurum==="siparis_verildi"?{siparisVerildiAt:now}:{}),
                  ...(yeniDurum==="yolda"?{yoldaAt:now}:{}),
                  ...(yeniDurum==="teslim_alindi"?{teslimAlindiAt:now}:{}),
                  ...ekBilgi
                };
              }));
            };

            // Teslim al + stok güncelle
            const teslimAl = (ts) => {
              // Stok artır
              (ts.kalemler||[]).forEach(k=>{
                setHamMaddeler(p=>p.map(hm=>{
                  if(hm.id!==k.hamMaddeId) return hm;
                  const yeniMiktar=(hm.miktar||0)+(k.miktar||0);
                  stokHareketiRepo.ekle({
                    stokTipi:"hammadde",stokId:hm.id,hareketTipi:"satin_alma_girisi",
                    miktar:k.miktar,birim:k.birim||hm.birim,
                    oncekiBakiye:hm.miktar||0,sonrakiBakiye:yeniMiktar,
                    kaynakModul:"tedarik",note:"Tedarik teslim: "+hm.ad
                  });
                  return {...hm,miktar:yeniMiktar};
                }));
              });
              // Durum güncelle
              durumGecis(ts.id,"teslim_alindi");
            };

            // Kalem kartı render helper
            const KalemSatir = ({k,compact}) => (
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                padding:compact?"4px 0":"6px 0",borderBottom:"1px solid "+C.border+"40",fontSize:compact?10:11}}>
                <div style={{flex:1,minWidth:0}}>
                  <span style={{color:C.text,fontWeight:600}}>{k.ad}</span>
                  {k.sipNo&&<span style={{color:C.muted,marginLeft:6,fontSize:8}}>({k.sipNo})</span>}
                </div>
                <div style={{display:"flex",gap:8,flexShrink:0,alignItems:"center"}}>
                  <span style={{color:C.coral,fontWeight:700}}>{fmt(k.miktar,1)} <span style={{fontWeight:400,color:C.muted,fontSize:9}}>{k.birim}</span></span>
                  {k.birimFiyat>0&&<span style={{color:C.muted,fontSize:9}}>~{fmt(k.birimFiyat*k.miktar)}₺</span>}
                </div>
              </div>
            );

            // Tedarik sipariş kartı (sipariş verildi / yolda)
            const SiparisKart = ({ts,aksiyon,aksiyonLabel,aksiyonRenk,aksiyonIkon,borderRenk}) => {
              const topTutar = (ts.kalemler||[]).reduce((s,k)=>(k.birimFiyat||0)*(k.miktar||0)+s,0);
              return(
                <div style={{background:"rgba(255,255,255,0.025)",border:"1px solid "+borderRenk+"25",
                  borderLeft:"3px solid "+borderRenk,borderRadius:10,padding:"12px 16px",marginBottom:8,
                  animation:"fade-up .3s ease"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                        <span style={{fontSize:10,fontWeight:700,color:borderRenk,background:borderRenk+"12",borderRadius:4,padding:"2px 6px"}}>{ts.id.slice(0,12)}</span>
                        <span style={{fontSize:13,fontWeight:700,color:C.text}}>{ts.tedarikci||"—"}</span>
                        {ts.kaynakSipNo&&<span style={{fontSize:9,color:C.lav,background:C.lav+"10",borderRadius:3,padding:"1px 5px"}}>{ts.kaynakSipNo}</span>}
                      </div>
                      {(ts.kalemler||[]).map((k,ki)=>(
                        <div key={ki} style={{fontSize:11,color:C.sub,marginBottom:2,paddingLeft:8,borderLeft:"2px solid "+C.border}}>
                          {k.ad} — <strong style={{color:C.text}}>{fmt(k.miktar,1)} {k.birim}</strong>
                        </div>
                      ))}
                      <div style={{display:"flex",gap:10,fontSize:9,color:C.muted,marginTop:4,flexWrap:"wrap"}}>
                        {ts.beklenenTeslimAt&&(()=>{
                          const gun=Math.ceil((new Date(ts.beklenenTeslimAt)-Date.now())/86400000);
                          return <span style={{color:gun<0?C.coral:C.cyan}}>📅 Beklenen: {new Date(ts.beklenenTeslimAt).toLocaleDateString("tr-TR")}{gun<0?` (${Math.abs(gun)} gün gecikti!)`:` (${gun} gün)`}</span>;
                        })()}
                        {ts.siparisVerildiAt&&<span>🛒 {new Date(ts.siparisVerildiAt).toLocaleDateString("tr-TR")}</span>}
                        {topTutar>0&&<span>💰 ~{fmt(topTutar)}₺</span>}
                        {ts.nakliyeci&&<span>🚚 {ts.nakliyeci}</span>}
                      </div>
                    </div>
                    <button onClick={()=>aksiyon(ts)}
                      style={{background:aksiyonRenk+"15",border:"1px solid "+aksiyonRenk+"30",
                      borderRadius:7,padding:"6px 12px",fontSize:11,fontWeight:700,
                      color:aksiyonRenk,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>
                      {aksiyonIkon} {aksiyonLabel}
                    </button>
                  </div>
                </div>
              );
            };

            return(
            <div style={{animation:"fade-up .35s ease"}}>
              <PageHeader title="Tedarik Yönetimi"
                sub={bekleyenKalem>0?bekleyenKalem+" kalem sipariş bekliyor":"Tüm malzemeler temin edildi"}
                action={null}/>

              {/* ── GÖRÜNÜM TOGGLE ── */}
              <div style={{display:"flex",gap:6,marginBottom:14}}>
                {[["toplu","📦 Toplu Görünüm"],["urun_bazli","🏭 Ürün Bazlı"],["siparis_bazli","📋 Sipariş Bazlı"]].map(([k,l])=>(
                  <button key={k} onClick={()=>setTedGorMode(k)}
                    style={{padding:"6px 14px",borderRadius:8,fontSize:11,fontWeight:tedGorMode===k?700:400,
                      background:tedGorMode===k?C.cyan+"12":"rgba(255,255,255,.03)",
                      border:"1px solid "+(tedGorMode===k?C.cyan+"40":C.border),
                      color:tedGorMode===k?C.cyan:C.muted,cursor:"pointer",transition:"all .15s"}}>{l}</button>
                ))}
              </div>

              {/* ── DASHBOARD KARTLARI ── */}
              <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap",alignItems:"center"}}>
                {[
                  {l:"Sipariş Bekliyor",v:bekleyenler.length,c:C.coral,ikon:"⚠",id:"bekleyen"},
                  {l:"Sipariş Verildi",v:siparisVerilenler.length,c:C.sky,ikon:"🛒",id:"siparis"},
                  {l:"Yolda",v:yoldakiler.length,c:"#E8914A",ikon:"🚚",id:"yolda"},
                  {l:"Fasonda",v:fasondakiler.length,c:C.lav,ikon:"🏭",id:"fasonda"},
                  {l:"Teslim Alındı",v:tamamlananlar.length,c:C.mint,ikon:"✅",id:"tamam"},
                ].map(k=>(
                  <button key={k.id} onClick={()=>{
                    const el=document.getElementById("tedarik-"+k.id);
                    el?.scrollIntoView({behavior:"smooth",block:"start"});
                  }} style={{background:k.c+"0C",border:"1px solid "+k.c+"20",
                    borderRadius:12,padding:"12px 18px",display:"flex",alignItems:"center",gap:8,
                    cursor:"pointer",transition:"all .15s",minWidth:100}}
                    onMouseEnter={e=>{e.currentTarget.style.background=k.c+"18";e.currentTarget.style.transform="translateY(-2px)";}}
                    onMouseLeave={e=>{e.currentTarget.style.background=k.c+"0C";e.currentTarget.style.transform="translateY(0)";}}>
                    <span style={{fontSize:22}}>{k.ikon}</span>
                    <div>
                      <div style={{fontSize:20,fontWeight:800,color:k.c,fontFamily:F,lineHeight:1}}>{k.v}</div>
                      <div style={{fontSize:9,color:C.muted,whiteSpace:"nowrap"}}>{k.l}</div>
                    </div>
                  </button>
                ))}
              </div>

              {/* ── BOŞ DURUM ── */}
              {tSip.length===0&&(
                <div style={{textAlign:"center",padding:"60px",color:C.muted}}>
                  <div style={{fontSize:48,marginBottom:12}}>📦</div>
                  <div style={{fontSize:16,color:C.sub,fontWeight:600}}>Tedarik bekleyen malzeme yok</div>
                  <div style={{fontSize:12,marginTop:6}}>Atölyeden "Tedariğe Gönder" butonuyla malzeme gönderildiğinde burada görünecek</div>
                </div>
              )}

              {/* ═══════════ TOPLU GÖRÜNÜM ═══════════ */}
              {tedGorMode==="toplu"&&(
                <>
                  {/* Sipariş Bekliyor */}
                  {bekleyenler.length>0&&(
                    <div id="tedarik-bekleyen" style={{marginBottom:28}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,
                        paddingBottom:8,borderBottom:"2px solid "+C.coral+"30"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:16}}>⚠</span>
                          <span style={{fontSize:13,fontWeight:800,color:C.coral,letterSpacing:.5,textTransform:"uppercase"}}>
                            Sipariş Bekliyor
                          </span>
                          <span style={{fontSize:11,color:C.muted}}>— {bekleyenKalem} kalem, {tedGrupListe.length} tedarikçi</span>
                        </div>
                        {bekleyenler.length>1&&(
                          <button onClick={()=>bekleyenler.forEach(ts=>durumGecis(ts.id,"siparis_verildi"))}
                            style={{background:C.cyan+"12",border:"1px solid "+C.cyan+"25",
                            borderRadius:9,padding:"7px 14px",fontSize:11,fontWeight:700,
                            color:C.cyan,cursor:"pointer"}}>
                            🛒 Tümüne Sipariş Ver ({bekleyenler.length})
                          </button>
                        )}
                      </div>

                      {tedGrupListe.map((grup,gi)=>{
                        const isBelrsz = grup.tedarikci==="Belirtilmemiş";
                        const gRenk = isBelrsz?C.muted:C.sky;
                        const gIkon = isBelrsz?"❓":"📦";
                        return(
                          <div key={gi} style={{background:"rgba(255,255,255,0.02)",border:"1px solid "+gRenk+"20",
                            borderRadius:14,overflow:"hidden",marginBottom:10,
                            animation:"fade-up .3s "+gi*.06+"s ease both"}}>
                            <div style={{padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",
                              background:gRenk+"08",borderBottom:"1px solid "+gRenk+"15"}}>
                              <div style={{display:"flex",alignItems:"center",gap:8}}>
                                <span style={{fontSize:16}}>{gIkon}</span>
                                <div>
                                  <div style={{fontSize:13,fontWeight:700,color:C.text}}>{grup.tedarikci}</div>
                                  <div style={{fontSize:10,color:C.muted}}>{grup.kalemler.length} kalem</div>
                                </div>
                              </div>
                              <div style={{display:"flex",gap:6}}>
                                <button onClick={()=>grup.siparisler.forEach(ts=>durumGecis(ts.id,"siparis_verildi"))}
                                  style={{background:C.cyan+"15",border:"1px solid "+C.cyan+"30",
                                  borderRadius:8,padding:"6px 14px",fontSize:11,fontWeight:700,
                                  color:C.cyan,cursor:"pointer"}}>📞 Sipariş Ver</button>
                              </div>
                            </div>
                            <div style={{padding:"8px 16px"}}>
                              {grup.kalemler.map((k,ki)=>(
                                <KalemSatir key={ki} k={k}/>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Sipariş Verildi */}
                  {siparisVerilenler.length>0&&(
                    <div id="tedarik-siparis" style={{marginBottom:28}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,
                        paddingBottom:8,borderBottom:"2px solid "+C.sky+"30"}}>
                        <span style={{fontSize:16}}>🛒</span>
                        <span style={{fontSize:13,fontWeight:800,color:C.sky,letterSpacing:.5,textTransform:"uppercase"}}>
                          Sipariş Verildi
                        </span>
                      </div>
                      {siparisVerilenler.map(ts=>(
                        <SiparisKart key={ts.id} ts={ts} borderRenk={C.sky}
                          aksiyon={(t)=>durumGecis(t.id,"yolda")}
                          aksiyonLabel="Yolda" aksiyonIkon="🚚" aksiyonRenk={"#E8914A"}/>
                      ))}
                    </div>
                  )}

                  {/* Yolda */}
                  {yoldakiler.length>0&&(
                    <div id="tedarik-yolda" style={{marginBottom:28}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,
                        paddingBottom:8,borderBottom:"2px solid rgba(232,145,74,.3)"}}>
                        <span style={{fontSize:16}}>🚚</span>
                        <span style={{fontSize:13,fontWeight:800,color:"#E8914A",letterSpacing:.5,textTransform:"uppercase"}}>
                          Yolda / Nakliyede
                        </span>
                      </div>
                      {yoldakiler.map(ts=>(
                        <SiparisKart key={ts.id} ts={ts} borderRenk={"#E8914A"}
                          aksiyon={(t)=>teslimAl(t)}
                          aksiyonLabel="Teslim Al" aksiyonIkon="📥" aksiyonRenk={C.mint}/>
                      ))}
                    </div>
                  )}

                  {/* Fasonda */}
                  {fasondakiler.length>0&&(
                    <div id="tedarik-fasonda" style={{marginBottom:28}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,
                        paddingBottom:8,borderBottom:"2px solid "+C.lav+"30"}}>
                        <span style={{fontSize:16}}>🏭</span>
                        <span style={{fontSize:13,fontWeight:800,color:C.lav,letterSpacing:.5,textTransform:"uppercase"}}>Fasonda</span>
                      </div>
                      {fasondakiler.map(ts=>(
                        <div key={ts.id} style={{background:C.lav+"06",border:"1px solid "+C.lav+"20",
                          borderLeft:"3px solid "+C.lav,borderRadius:10,padding:"12px 16px",marginBottom:8}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <div>
                              <div style={{fontSize:13,fontWeight:700,color:C.text}}>🏭 {ts.fasonYonlendirme?.fasonFirmaAd||ts.tedarikci||"Fason"}</div>
                              <div style={{fontSize:10,color:C.muted,marginTop:2}}>
                                {(ts.kalemler||[]).map(k=>k.ad).join(", ")}
                                {ts.fasonYonlendirme?.gonderimAt&&<span> · Gönderildi: {new Date(ts.fasonYonlendirme.gonderimAt).toLocaleDateString("tr-TR")}</span>}
                              </div>
                            </div>
                            <button onClick={()=>{
                              teslimAl(ts);
                            }} style={{background:C.mint+"15",border:"1px solid "+C.mint+"30",
                              borderRadius:7,padding:"6px 12px",fontSize:11,fontWeight:700,
                              color:C.mint,cursor:"pointer"}}>✅ Geri Geldi</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Tamamlandı */}
                  {tamamlananlar.length>0&&(
                    <div id="tedarik-tamam" style={{marginBottom:28}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,
                        paddingBottom:8,borderBottom:"2px solid "+C.mint+"30"}}>
                        <span style={{fontSize:16}}>✅</span>
                        <span style={{fontSize:13,fontWeight:800,color:C.mint,letterSpacing:.5,textTransform:"uppercase"}}>Teslim Alındı</span>
                      </div>
                      {tamamlananlar.map(ts=>(
                        <div key={ts.id} style={{background:C.mint+"04",border:"1px solid "+C.mint+"18",
                          borderLeft:"3px solid "+C.mint,borderRadius:10,padding:"10px 16px",marginBottom:6}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <div>
                              <div style={{fontSize:12,fontWeight:600,color:C.text}}>
                                {ts.tedarikci||"—"} · Teslim: {ts.teslimAlindiAt?new Date(ts.teslimAlindiAt).toLocaleDateString("tr-TR"):"—"}
                              </div>
                              <div style={{fontSize:10,color:C.muted,marginTop:2}}>
                                {(ts.kalemler||[]).map(k=>fmt(k.miktar,1)+" "+k.birim+" "+k.ad).join(" · ")}
                                {ts.faturaNo&&<span> · 🧾 {ts.faturaNo}</span>}
                              </div>
                            </div>
                            <span style={{fontSize:10,color:C.mint,padding:"4px 8px",background:C.mint+"10",borderRadius:6}}>✓ Stoka Eklendi</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* ═══════════ ÜRÜN BAZLI GÖRÜNÜM ═══════════ */}
              {tedGorMode==="urun_bazli"&&(
                <>
                  {bekleyenler.length===0&&(
                    <div style={{textAlign:"center",padding:"40px",color:C.muted,fontSize:13}}>
                      Sipariş bekleyen malzeme yok
                    </div>
                  )}
                  {Object.entries(urunGrup).map(([key,grp],gi)=>(
                    <div key={key} style={{background:"rgba(255,255,255,0.02)",border:"1px solid "+C.cyan+"20",
                      borderRadius:14,overflow:"hidden",marginBottom:10,animation:"fade-up .3s "+gi*.06+"s ease both"}}>
                      <div style={{padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",
                        background:C.cyan+"08",borderBottom:"1px solid "+C.cyan+"15"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:16}}>🏭</span>
                          <div>
                            <div style={{fontSize:13,fontWeight:700,color:C.text}}>{grp.label}</div>
                            <div style={{fontSize:10,color:C.muted}}>{grp.kalemler.length} kalem</div>
                          </div>
                        </div>
                      </div>
                      <div style={{padding:"8px 16px"}}>
                        {grp.kalemler.map((k,ki)=>(
                          <KalemSatir key={ki} k={k}/>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* ═══════════ SİPARİŞ BAZLI GÖRÜNÜM ═══════════ */}
              {tedGorMode==="siparis_bazli"&&(
                <>
                  {bekleyenler.length===0&&(
                    <div style={{textAlign:"center",padding:"40px",color:C.muted,fontSize:13}}>
                      Sipariş bekleyen malzeme yok
                    </div>
                  )}
                  {Object.entries(sipGrup).map(([sNo,grp],gi)=>(
                    <div key={sNo} style={{background:"rgba(255,255,255,0.02)",border:"1px solid "+C.lav+"20",
                      borderRadius:14,overflow:"hidden",marginBottom:10,animation:"fade-up .3s "+gi*.06+"s ease both"}}>
                      <div style={{padding:"10px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",
                        background:C.lav+"08",borderBottom:"1px solid "+C.lav+"15"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:16}}>📋</span>
                          <div>
                            <div style={{fontSize:13,fontWeight:700,color:C.text}}>{grp.sipNo}</div>
                            <div style={{fontSize:10,color:C.muted}}>{grp.kalemler.length} kalem · {grp.siparisler.length} tedarik emri</div>
                          </div>
                        </div>
                        <button onClick={()=>grp.siparisler.forEach(ts=>durumGecis(ts.id,"siparis_verildi"))}
                          style={{background:C.cyan+"15",border:"1px solid "+C.cyan+"30",
                          borderRadius:8,padding:"6px 14px",fontSize:11,fontWeight:700,
                          color:C.cyan,cursor:"pointer"}}>📞 Sipariş Ver</button>
                      </div>
                      <div style={{padding:"8px 16px"}}>
                        {grp.kalemler.map((k,ki)=>(
                          <div key={ki} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                            padding:"6px 0",borderBottom:ki<grp.kalemler.length-1?"1px solid "+C.border+"40":"none",fontSize:11}}>
                            <div style={{flex:1,minWidth:0}}>
                              <span style={{color:C.text,fontWeight:600}}>{k.ad}</span>
                              {k.tedarikci&&<span style={{color:C.muted,marginLeft:6,fontSize:8}}>📦 {k.tedarikci}</span>}
                            </div>
                            <span style={{color:C.coral,fontWeight:700}}>{fmt(k.miktar,1)} <span style={{fontWeight:400,color:C.muted,fontSize:9}}>{k.birim}</span></span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
            );
          })()}



          {/* ─ MÜŞTERİLER ─ */}
          {tab==="musteriler"&&(()=>{
            // Tip renk/label
            const TIP_META = {
              bayi:     {label:"Bayi / Distribütör", renk:C.lav,   ikon:"🏢"},
              direkt:   {label:"Direkt Müşteri",      renk:C.cyan,  ikon:"🏪"},
              kurumsal: {label:"Kurumsal / İhale",    renk:C.gold,  ikon:"🏛"},
            };
            const bayiler   = musteriler.filter(m=>m.tip==="bayi");
            const direktler = musteriler.filter(m=>m.tip==="direkt");
            const kurumsal  = musteriler.filter(m=>m.tip==="kurumsal");

            const MusteriKart = ({m, idx}) => {
              const meta = TIP_META[m.tip]||TIP_META.direkt;
              const subSayisi = (m.subeler||[]).length;
              const altMusteriSayisi = (m.altMusteriler||[]).length;
              const siparisSayisi = siparisler.filter(s=>s.musteriId===m.id).length;
              return(
                <div className="card" style={{background:"rgba(255,255,255,0.025)",
                  border:`1px solid ${C.border}`,borderLeft:`3px solid ${meta.renk}`,
                  borderRadius:16,padding:"16px 20px",cursor:"pointer",
                  animation:`fade-up .3s ${idx*.04}s ease both`}}
                  onClick={()=>setModal({type:"musteriDetay",data:m})}>
                  {/* Başlık */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                        <span style={{fontSize:14}}>{meta.ikon}</span>
                        <span style={{fontSize:14,fontWeight:700,color:C.text,fontFamily:F,
                          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.ad}</span>
                      </div>
                      {m.tip==="bayi"&&m.bayiAdi&&(
                        <div style={{fontSize:10,color:meta.renk,marginBottom:2}}>
                          🔗 {m.bayiAdi} kanalı
                        </div>
                      )}
                      {m.yetkili&&<div style={{fontSize:10,color:C.muted}}>{m.yetkili}</div>}
                    </div>
                    <span style={{fontSize:9,background:`${meta.renk}15`,color:meta.renk,
                      borderRadius:5,padding:"2px 8px",flexShrink:0,fontWeight:700}}>
                      {meta.label}
                    </span>
                  </div>
                  {/* İletişim */}
                  <div style={{display:"flex",gap:10,fontSize:10,color:C.muted,flexWrap:"wrap",marginBottom:8}}>
                    {m.tel&&<span>📞 {m.tel}</span>}
                    {m.email&&<span>✉ {m.email}</span>}
                    {m.whatsapp&&<span style={{color:"#25D366"}}>💬 WA</span>}
                  </div>
                  {/* Şube / Alt müşteri listesi */}
                  {m.tip==="bayi"&&altMusteriSayisi>0&&(
                    <div style={{marginBottom:8}}>
                      <div style={{fontSize:9,color:C.muted,marginBottom:4}}>
                        Alt müşteriler ({altMusteriSayisi}):
                      </div>
                      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                        {(m.altMusteriler||[]).slice(0,4).map((alt,j)=>(
                          <span key={j} style={{fontSize:9,background:`${C.lav}12`,
                            border:`1px solid ${C.lav}20`,borderRadius:4,
                            padding:"1px 6px",color:C.lav}}>{alt.ad}</span>
                        ))}
                        {altMusteriSayisi>4&&<span style={{fontSize:9,color:C.muted}}>+{altMusteriSayisi-4}</span>}
                      </div>
                    </div>
                  )}
                  {m.tip!=="bayi"&&subSayisi>0&&(
                    <div style={{marginBottom:8}}>
                      <div style={{fontSize:9,color:C.muted,marginBottom:4}}>
                        Teslimat noktaları ({subSayisi}):
                      </div>
                      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                        {(m.subeler||[]).slice(0,3).map((s,j)=>(
                          <span key={j} style={{fontSize:9,background:"rgba(255,255,255,0.05)",
                            borderRadius:4,padding:"1px 6px",color:C.muted}}>{s.ad}</span>
                        ))}
                        {subSayisi>3&&<span style={{fontSize:9,color:C.muted}}>+{subSayisi-3}</span>}
                      </div>
                    </div>
                  )}
                  {/* Footer */}
                  <div style={{paddingTop:8,borderTop:`1px solid ${C.border}`,
                    display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:10,color:C.muted}}>
                      {siparisSayisi>0?`${siparisSayisi} sipariş`:"Sipariş yok"}
                    </span>
                    <div style={{display:"flex",gap:6}}>
                      <button onClick={e=>{e.stopPropagation();
                        setModal({type:"yeniSiparis",data:{musteriId:m.id,musteriAd:m.ad}});}}
                        style={{fontSize:9,background:`${C.cyan}12`,border:`1px solid ${C.cyan}25`,
                        borderRadius:5,padding:"3px 8px",color:C.cyan,cursor:"pointer",fontWeight:600}}>
                        + Sipariş
                      </button>
                      <button onClick={e=>{e.stopPropagation();
                        setModal({type:"musteriDetay",data:m});}}
                        style={{fontSize:9,background:"rgba(255,255,255,0.05)",
                        border:`1px solid ${C.border}`,
                        borderRadius:5,padding:"3px 8px",color:C.muted,cursor:"pointer"}}>
                        Düzenle
                      </button>
                    </div>
                  </div>
                </div>
              );
            };

            return(
            <div style={{animation:"fade-up .35s ease"}}>
              <PageHeader title="Müşteriler" sub={`${musteriler.length} müşteri · ${siparisler.length} toplam sipariş`}
                action={<Btn variant="primary" onClick={()=>setModal({type:"yeniMusteri",data:{}})}>+ Müşteri Ekle</Btn>}/>

              {musteriler.length===0&&(
                <div style={{textAlign:"center",padding:"80px 40px"}}>
                  <div style={{fontSize:48,marginBottom:16}}>👥</div>
                  <div style={{fontSize:18,fontWeight:700,color:C.sub,fontFamily:F,marginBottom:8}}>
                    Henüz müşteri eklenmedi
                  </div>
                  <div style={{fontSize:13,color:C.muted,marginBottom:24}}>
                    Bayi, direkt müşteri veya kurumsal müşteri ekleyin
                  </div>
                  <Btn variant="primary" onClick={()=>setModal({type:"yeniMusteri",data:{}})}>
                    + İlk Müşteriyi Ekle
                  </Btn>
                </div>
              )}

              {/* Bayi / Distribütörler */}
              {bayiler.length>0&&(
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,fontWeight:700,color:C.lav,letterSpacing:1,
                    textTransform:"uppercase",marginBottom:10}}>
                    🏢 Bayi & Distribütörler — {bayiler.length}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:10}}>
                    {bayiler.map((m,i)=><MusteriKart key={m.id} m={m} idx={i}/>)}
                  </div>
                </div>
              )}

              {/* Direkt Müşteriler */}
              {direktler.length>0&&(
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,fontWeight:700,color:C.cyan,letterSpacing:1,
                    textTransform:"uppercase",marginBottom:10}}>
                    🏪 Direkt Müşteriler — {direktler.length}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:10}}>
                    {direktler.map((m,i)=><MusteriKart key={m.id} m={m} idx={i}/>)}
                  </div>
                </div>
              )}

              {/* Kurumsal */}
              {kurumsal.length>0&&(
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,fontWeight:700,color:C.gold,letterSpacing:1,
                    textTransform:"uppercase",marginBottom:10}}>
                    🏛 Kurumsal & İhale — {kurumsal.length}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:10}}>
                    {kurumsal.map((m,i)=><MusteriKart key={m.id} m={m} idx={i}/>)}
                  </div>
                </div>
              )}
            </div>
            );
          })()}

          {/* ─ SEVKİYAT ─ */}
          {tab==="sevkiyat"&&(()=>{
            const hazir    = sevkiyatlar.filter(s=>s.durum==="hazirlaniyor"||s.durum==="bekliyor");
            const yolda    = sevkiyatlar.filter(s=>s.durum==="yolda");
            const teslim   = sevkiyatlar.filter(s=>s.durum==="teslim");
            return(
            <div style={{animation:"fade-up .35s ease"}}>
              <PageHeader title="Sevkiyat" sub={`${hazir.length} hazırlanıyor · ${yolda.length} yolda`}
                action={<Btn variant="primary" onClick={()=>setModal({type:"yeniSevkiyat",data:{}})}>+ Sevkiyat Planla</Btn>}/>

              {/* Özet */}
              <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
                {[
                  {l:"Hazırlanıyor",v:hazir.length,c:C.gold,ikon:"📦"},
                  {l:"Yolda",v:yolda.length,c:C.cyan,ikon:"🚚"},
                  {l:"Teslim Edildi",v:teslim.length,c:C.mint,ikon:"✅"},
                ].map(k=>(
                  <div key={k.l} style={{background:`${k.c}0C`,border:`1px solid ${k.c}20`,
                    borderRadius:9,padding:"10px 16px",display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:20}}>{k.ikon}</span>
                    <div>
                      <div style={{fontSize:18,fontWeight:800,color:k.c,fontFamily:F,lineHeight:1}}>{k.v}</div>
                      <div style={{fontSize:10,color:C.muted}}>{k.l}</div>
                    </div>
                  </div>
                ))}
              </div>

              {sevkiyatlar.length===0&&(
                <div style={{textAlign:"center",padding:"80px 40px"}}>
                  <div style={{fontSize:48,marginBottom:16}}>🚚</div>
                  <div style={{fontSize:18,fontWeight:700,color:C.sub,fontFamily:F,marginBottom:8}}>Henüz sevkiyat planlanmadı</div>
                  <div style={{fontSize:13,color:C.muted,marginBottom:24}}>
                    Hazır ürünler için sevkiyat planı oluşturun — nakliyeci, irsaliye, teslim onayı burada takip edilecek
                  </div>
                  <Btn variant="primary" onClick={()=>setModal({type:"yeniSevkiyat",data:{}})}>+ Sevkiyat Planla</Btn>
                </div>
              )}

              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {sevkiyatlar.map((s,i)=>{
                  const musteri = musteriler.find(m=>m.id===s.musteriId);
                  const renkMap = {hazirlaniyor:C.gold,bekliyor:C.coral,yolda:C.cyan,teslim:C.mint};
                  const renk = renkMap[s.durum]||C.muted;
                  return(
                    <div key={s.id} style={{background:"rgba(255,255,255,0.025)",
                      border:`1px solid ${renk}25`,borderLeft:`3px solid ${renk}`,
                      borderRadius:12,padding:"12px 16px",cursor:"pointer"}}
                      onClick={()=>setModal({type:"sevkiyatDetay",data:s})}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                        <div>
                          <div style={{fontSize:13,fontWeight:700,color:C.text}}>{musteri?.ad||s.musteriAd||"Müşteri"}</div>
                          <div style={{fontSize:11,color:C.muted,marginTop:2}}>
                            {s.subAd&&<span>{s.subAd} · </span>}
                            {s.nakliyeci&&<span>🚚 {s.nakliyeci} · </span>}
                            {s.planlananTarih&&<span>📅 {s.planlananTarih}</span>}
                          </div>
                        </div>
                        <div style={{display:"flex",gap:8,alignItems:"center"}}>
                          {s.irsaliyeNo&&<span style={{fontSize:10,color:C.muted}}>İrs: {s.irsaliyeNo}</span>}
                          <span style={{fontSize:10,background:`${renk}15`,color:renk,
                            borderRadius:5,padding:"2px 8px",fontWeight:700}}>
                            {s.durum==="hazirlaniyor"?"Hazırlanıyor":s.durum==="yolda"?"Yolda":
                             s.durum==="teslim"?"Teslim Edildi":"Bekliyor"}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            );
          })()}

          {/* ─ FASON TAKİP ─ */}
          {tab==="fason_takip"&&(()=>{
            // Eski fason işler
            const fasonBekleyen   = fasonIsler.filter(f=>f.durum==="bekliyor");
            const fasonGonderilen = fasonIsler.filter(f=>f.durum==="gonderildi");
            const fasonDonen      = fasonIsler.filter(f=>f.durum==="dond");
            const fasonTamam      = fasonIsler.filter(f=>f.durum==="tamam");

            // tedarikSiparisleri'nden gelen fason işler
            const tsFasonAktif = tedarikSiparisleri.filter(ts=>ts.durum==="fasona_gonderildi"||ts.durum==="fasonda");
            const tsFasonBiten = tedarikSiparisleri.filter(ts=>ts.durum==="fasondan_geldi");

            // Üretim emirlerindeki aktif fason aşamaları
            const ueFasonlar = uretimEmirleri.filter(e=>e.durum!=="tamamlandi").flatMap(ue=>
              (ue.asamalar||[]).filter(a=>a.fason).map(a=>({...a,ueKod:ue.kod,ueAd:ue.urunAd,ueId:ue.id,ueAdet:ue.adet}))
            );
            const ueFasonAktif = ueFasonlar.filter(a=>a.fasonDurum==="gonderildi"||a.durum==="devam");
            const ueFasonBekleyen = ueFasonlar.filter(a=>!a.fasonDurum&&a.durum==="bekliyor");

            // Firma bazlı gruplama — tüm kaynaklardan
            const firmaMap = {};
            const fasonHizmetler = (hizmetler||[]).filter(h=>h.tip==="fason");

            // Fason firmalar listesi
            fasonHizmetler.forEach(fh=>{
              if(!firmaMap[fh.id]) firmaMap[fh.id]={firma:fh, aktifIsler:[], bekleyenIsler:[], bitenIsler:[]};
            });

            // UE fasonlarını firmaya eşle
            ueFasonlar.forEach(a=>{
              const fhId = a.hizmetId;
              if(fhId && firmaMap[fhId]){
                if(a.fasonDurum==="gonderildi"||a.durum==="devam") firmaMap[fhId].aktifIsler.push(a);
                else if(a.durum==="bitti") firmaMap[fhId].bitenIsler.push(a);
                else firmaMap[fhId].bekleyenIsler.push(a);
              }
            });

            // tedarikSiparisleri fasonlarını firmaya eşle
            tsFasonAktif.forEach(ts=>{
              const fhId = ts.fasonYonlendirme?.fasonFirmaId;
              if(fhId && firmaMap[fhId]) firmaMap[fhId].aktifIsler.push({...ts, _tip:"tedarik"});
            });

            const firmalar = Object.values(firmaMap).filter(f=>f.aktifIsler.length>0||f.bekleyenIsler.length>0||f.bitenIsler.length>0);
            const toplamAktif = Object.values(firmaMap).reduce((s,f)=>s+f.aktifIsler.length,0);
            const toplamBekleyen2 = Object.values(firmaMap).reduce((s,f)=>s+f.bekleyenIsler.length,0);

            return(
            <div style={{animation:"fade-up .35s ease"}}>
              <PageHeader title="Fason Takip" sub={`${toplamAktif} iş firmada · ${firmalar.length} aktif firma`}
                action={<Btn variant="primary" onClick={()=>setModal({type:"yeniFasonIs",data:{}})}>+ Fason İş Emri</Btn>}/>

              {/* Özet kartları */}
              <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
                {[
                  {l:"Bekleyen",v:fasonBekleyen.length+toplamBekleyen2,c:C.coral,ikon:"⏳"},
                  {l:"Firmada",v:fasonGonderilen.length+toplamAktif,c:C.gold,ikon:"🏭"},
                  {l:"Döndü / Geldi",v:fasonDonen.length+tsFasonBiten.length,c:C.cyan,ikon:"📥"},
                  {l:"Tamamlandı",v:fasonTamam.length,c:C.mint,ikon:"✅"},
                  {l:"Aktif Firma",v:firmalar.length,c:C.lav,ikon:"🔗"},
                ].map(k=>(
                  <div key={k.l} style={{background:`${k.c}0C`,border:`1px solid ${k.c}20`,
                    borderRadius:12,padding:"10px 16px",display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:20}}>{k.ikon}</span>
                    <div>
                      <div style={{fontSize:18,fontWeight:800,color:k.c,fontFamily:F,lineHeight:1}}>{k.v}</div>
                      <div style={{fontSize:9,color:C.muted}}>{k.l}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Firma bazlı kartlar */}
              {firmalar.length>0&&(
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,fontWeight:700,color:C.lav,letterSpacing:1,textTransform:"uppercase",marginBottom:12}}>
                    🏭 Firma Bazlı Görünüm
                  </div>
                  {firmalar.map(({firma,aktifIsler,bekleyenIsler,bitenIsler})=>(
                    <div key={firma.id} style={{background:"rgba(255,255,255,0.02)",border:`1px solid ${C.lav}20`,
                      borderRadius:14,overflow:"hidden",marginBottom:10}}>
                      {/* Firma başlık */}
                      <div style={{padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",
                        background:`${C.lav}08`,borderBottom:`1px solid ${C.lav}15`}}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <span style={{fontSize:18}}>🏭</span>
                          <div>
                            <div style={{fontSize:14,fontWeight:700,color:C.text}}>{firma.ad||firma.firma||"—"}</div>
                            <div style={{fontSize:10,color:C.muted}}>
                              {firma.firma&&firma.firma!==firma.ad?firma.firma+" · ":""}
                              {firma.sureGun>0?`~${firma.sureGun} gün · `:""}
                              {firma.birimFiyat>0?`${firma.birimFiyat}₺/adet`:""}
                            </div>
                          </div>
                        </div>
                        <div style={{display:"flex",gap:8}}>
                          {aktifIsler.length>0&&<span style={{fontSize:10,background:`${C.gold}15`,color:C.gold,
                            borderRadius:6,padding:"3px 8px",fontWeight:700}}>⚡ {aktifIsler.length} aktif</span>}
                          {bekleyenIsler.length>0&&<span style={{fontSize:10,background:`${C.coral}15`,color:C.coral,
                            borderRadius:6,padding:"3px 8px",fontWeight:700}}>⏳ {bekleyenIsler.length} bekliyor</span>}
                        </div>
                      </div>
                      {/* İşler listesi */}
                      <div style={{padding:"8px 16px"}}>
                        {aktifIsler.map((is2,ii)=>(
                          <div key={ii} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                            padding:"8px 0",borderBottom:ii<aktifIsler.length-1?`1px solid ${C.border}`:"none"}}>
                            <div style={{flex:1}}>
                              <div style={{fontSize:12,fontWeight:600,color:C.text}}>
                                {is2._tip==="tedarik"
                                  ? (is2.kalemler||[]).map(k=>k.ad).join(", ")
                                  : `${is2.ueKod||""} — ${is2.ad||is2.ueAd||"İş"}`}
                              </div>
                              <div style={{fontSize:9,color:C.muted,marginTop:2,display:"flex",gap:8,flexWrap:"wrap"}}>
                                {is2.ueAdet&&<span>{is2.ueAdet} adet</span>}
                                {is2.fasonGonderimAt&&<span>📤 {new Date(is2.fasonGonderimAt).toLocaleDateString("tr-TR")}</span>}
                                {is2._tip==="tedarik"&&is2.fasonYonlendirme?.gonderimAt&&<span>📤 {new Date(is2.fasonYonlendirme.gonderimAt).toLocaleDateString("tr-TR")}</span>}
                                {firma.sureGun>0&&is2.fasonGonderimAt&&(()=>{
                                  const beklenen = new Date(new Date(is2.fasonGonderimAt).getTime()+firma.sureGun*86400000);
                                  const gecikme = Math.ceil((Date.now()-beklenen.getTime())/86400000);
                                  return gecikme>0?<span style={{color:C.coral,fontWeight:700}}>⚠ {gecikme} gün gecikti!</span>
                                    :<span style={{color:C.mint}}>📅 Beklenen: {beklenen.toLocaleDateString("tr-TR")}</span>;
                                })()}
                              </div>
                            </div>
                            <span style={{fontSize:9,background:`${C.gold}15`,color:C.gold,
                              borderRadius:5,padding:"2px 7px",fontWeight:600}}>Firmada</span>
                          </div>
                        ))}
                        {bekleyenIsler.map((is2,ii)=>(
                          <div key={"b"+ii} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                            padding:"8px 0",borderBottom:`1px solid ${C.border}`,opacity:.6}}>
                            <div style={{fontSize:12,color:C.muted}}>{is2.ueKod} — {is2.ad}</div>
                            <span style={{fontSize:9,color:C.muted}}>Sırada</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Boş durum */}
              {fasonIsler.length===0&&firmalar.length===0&&(
                <div style={{textAlign:"center",padding:"60px 40px"}}>
                  <div style={{fontSize:48,marginBottom:16}}>🔗</div>
                  <div style={{fontSize:18,fontWeight:700,color:C.sub,fontFamily:F,marginBottom:8}}>Henüz fason iş yok</div>
                  <div style={{fontSize:13,color:C.muted,marginBottom:24}}>
                    Üretim emri oluştururken fason aşamalar otomatik eklenir veya manuel ekleyebilirsiniz
                  </div>
                  <Btn variant="primary" onClick={()=>setModal({type:"yeniFasonIs",data:{}})}>+ Fason İş Emri Oluştur</Btn>
                </div>
              )}

              {/* Eski fason işler (geriye dönük uyumluluk) */}
              {fasonIsler.length>0&&(
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>
                    📋 Manuel Fason İşler
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {fasonIsler.map((f,i)=>{
                      const firma2 = fasonFirmalar.find(x=>x.id===f.firmaId);
                      const renkMap = {bekliyor:C.coral,gonderildi:C.gold,dond:C.cyan,tamam:C.mint};
                      const renk = renkMap[f.durum]||C.muted;
                      return(
                        <div key={f.id} style={{background:"rgba(255,255,255,0.025)",
                          border:`1px solid ${renk}25`,borderLeft:`3px solid ${renk}`,
                          borderRadius:12,padding:"12px 16px"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                            <div style={{flex:1}}>
                              <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:3}}>{f.ad||"Fason İş"}</div>
                              <div style={{fontSize:11,color:C.muted,display:"flex",gap:10,flexWrap:"wrap"}}>
                                {firma2&&<span>🏭 {firma2.ad}</span>}
                                {f.adet&&<span>{f.adet} adet</span>}
                                {f.gonderimTarihi&&<span>📤 {f.gonderimTarihi}</span>}
                                {f.tahminiDonus&&<span>📅 Tahmini: {f.tahminiDonus}</span>}
                              </div>
                            </div>
                            <div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"flex-end"}}>
                              <span style={{fontSize:10,background:`${renk}15`,color:renk,
                                borderRadius:5,padding:"2px 8px",fontWeight:700}}>
                                {f.durum==="bekliyor"?"Bekliyor":f.durum==="gonderildi"?"Firmada":
                                 f.durum==="dond"?"Döndü":"Tamamlandı"}
                              </span>
                              {f.durum==="bekliyor"&&(
                                <button onClick={()=>setFasonIsler(p=>p.map(x=>x.id===f.id?
                                  {...x,durum:"gonderildi",gonderimTarihi:new Date().toLocaleDateString("tr-TR")}:x))}
                                  style={{fontSize:10,background:`${C.gold}12`,border:`1px solid ${C.gold}25`,
                                  borderRadius:6,padding:"3px 8px",color:C.gold,cursor:"pointer"}}>📤 Gönder</button>
                              )}
                              {f.durum==="gonderildi"&&(
                                <button onClick={()=>setFasonIsler(p=>p.map(x=>x.id===f.id?
                                  {...x,durum:"dond",donusTarihi:new Date().toLocaleDateString("tr-TR")}:x))}
                                  style={{fontSize:10,background:`${C.cyan}12`,border:`1px solid ${C.cyan}25`,
                                  borderRadius:6,padding:"3px 8px",color:C.cyan,cursor:"pointer"}}>📥 Döndü</button>
                              )}
                              {f.durum==="dond"&&(
                                <button onClick={()=>setFasonIsler(p=>p.map(x=>x.id===f.id?{...x,durum:"tamam"}:x))}
                                  style={{fontSize:10,background:`${C.mint}12`,border:`1px solid ${C.mint}25`,
                                  borderRadius:6,padding:"3px 8px",color:C.mint,cursor:"pointer"}}>✅ Stoka Al</button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            );
          })()}

          {/* ─ İŞ EMİRLERİ ─ */}
          {tab==="isemirleri"&&(
            <div style={{animation:"fade-up .35s ease"}}>
              <PageHeader title="İş Emirleri" sub="Günlük çalışan görevleri"/>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:10}}>
                {calisanlar.map((c,ci)=>{
                  const gorevler=siparisler.flatMap(sp=>
                    sp.asamalar.filter(a=>a.calisan===c.ad&&(a.durum==="devam"||a.durum==="bekliyor"))
                      .map(a=>({...a,sipId:sp.id,sipUrun:sp.urun,sipAdet:sp.adet}))
                  );
                  const aktifGorev=gorevler.find(g=>g.durum==="devam");
                  return(
                    <div key={c.id} style={{background:"rgba(255,255,255,0.03)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:`1px solid ${C.border}`,borderRadius:16,overflow:"hidden",
                      animation:`fade-up .3s ${ci*.08}s ease both`}}>
                      <div style={{height:2,background:`linear-gradient(90deg,${C.cyan},${C.cyan}00)`}}/>
                      <div style={{padding:"14px 16px 10px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",gap:10}}>
                        <div style={{width:38,height:38,borderRadius:"50%",
                          background:`linear-gradient(135deg,${C.cyan}20,${C.lav}20)`,
                          border:`2px solid ${C.cyan}30`,display:"flex",alignItems:"center",
                          justifyContent:"center",fontSize:13,fontWeight:800,color:C.cyan,fontFamily:F}}>
                          {c.ad.split(" ").map(w=>w[0]).join("").slice(0,2)}
                        </div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:14,fontWeight:700,color:C.text,fontFamily:F}}>{c.ad}</div>
                          <div style={{fontSize:11,color:C.muted}}>{c.rol}</div>
                        </div>
                        {aktifGorev&&<div style={{width:8,height:8,borderRadius:"50%",background:C.mint,
                          animation:"pulse-dot 2s ease-in-out infinite"}}/>}
                      </div>
                      <div style={{padding:"8px 12px"}}>
                        {gorevler.length===0?<div style={{fontSize:12,color:C.muted,padding:"10px 4px",textAlign:"center"}}>Görev yok</div>:
                          gorevler.slice(0,3).map((g,gi)=>(
                            <div key={g.id} style={{padding:"8px 10px",borderRadius:9,marginBottom:4,
                              background:g.durum==="devam"?`${C.cyan}07`:"rgba(255,255,255,.02)",
                              border:`1px solid ${g.durum==="devam"?C.cyan+"22":C.border}`}}>
                              <div style={{display:"flex",gap:5,marginBottom:2}}>
                                <span style={{fontSize:9,background:`${C.cyan}18`,color:C.cyan,borderRadius:4,padding:"1px 5px",fontWeight:700}}>{g.sipId}</span>
                                {g.durum==="devam"&&<span style={{fontSize:9,background:`${C.mint}18`,color:C.mint,borderRadius:4,padding:"1px 5px",fontWeight:700}}>DEVAM</span>}
                              </div>
                              <div style={{fontSize:12,fontWeight:600,color:C.text}}>{g.ad}</div>
                              <div style={{fontSize:11,color:C.muted}}>{g.sipUrun} · {g.sipAdet} adet</div>
                              {g.sureDk>0&&<div style={{fontSize:10,color:C.muted,marginTop:1}}>~{g.sureDk} dk/adet</div>}
                            </div>
                          ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─ AI ─ */}
          {tab==="ai"&&(
            <div style={{animation:"fade-up .35s ease"}}>
              <PageHeader title="AI Asistan" sub="Akıllı planlama ve öneri motoru"/>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
                {[
                  ...(hamMaddeler.filter(x=>x.miktar<=x.minStok).slice(0,1).map(s=>({
                    col:C.coral,icon:"⚠️",title:`${s.ad} Stok Kritik`,
                    desc:`Mevcut: ${s.miktar} ${s.birim}, minimum: ${s.minStok} ${s.birim}. Acil tedarik gerekli.`,
                    cta:"Sipariş Ver"
                  }))),
                  ...(siparisler.filter(s=>s.durum==="bloke").slice(0,1).map(s=>({
                    col:C.lav,icon:"📅",title:`Termin Riski: ${s.id}`,
                    desc:`${s.urun} bloke durumda. Termin: ${s.termin}. ${s.notlar||""}`,
                    cta:"Müşteriyi Bildir"
                  }))),
                  ...(calisanlar.filter(c=>c.durum==="aktif").slice(0,1).map(c=>{
                    const bosta=!uretimEmirleri.flatMap(e=>(e.asamalar||[]).filter(a=>a.calisan===c.ad&&a.durum==="devam")).length;
                    return bosta?{col:C.gold,icon:"💡",title:"Kapasite Önerisi",
                      desc:`${c.ad} su an bosta. Bekleyen islere yonlendirilebilir.`,cta:"Onayla"}:null;
                  }).filter(Boolean)),
                  ...(hamMaddeler.filter(x=>x.miktar<=x.minStok).length===0&&siparisler.filter(s=>s.durum==="bloke").length===0?
                    [{col:C.mint,icon:"✅",title:"Her Sey Yolunda",desc:"Kritik stok alarmi veya bloke siparis yok.",cta:""}]:[]),
                ].map((a,i)=>(
                  <div key={i} style={{background:"rgba(255,255,255,0.03)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:`1px solid ${C.border}`,borderLeft:`3px solid ${a.col}`,
                    borderRadius:14,padding:"14px 18px",display:"flex",alignItems:"center",gap:12,
                    animation:`fade-up .3s ${i*.07}s ease both`}}>
                    <div style={{width:36,height:36,borderRadius:10,background:`${a.col}12`,border:`1px solid ${a.col}25`,
                      display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{a.icon}</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:2}}>{a.title}</div>
                      <div style={{fontSize:12,color:C.muted,lineHeight:1.5}}>{a.desc}</div>
                    </div>
                    <button style={{background:`${a.col}12`,border:`1px solid ${a.col}25`,borderRadius:8,
                      padding:"7px 14px",fontSize:12,fontWeight:600,color:a.col,cursor:"pointer",whiteSpace:"nowrap"}}>{a.cta}</button>
                  </div>
                ))}
              </div>
              <div style={{background:"rgba(255,255,255,0.03)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:`1px solid ${C.border}`,borderRadius:16,padding:"20px"}}>
                <div style={{fontSize:13,fontWeight:600,color:C.text,marginBottom:12}}>Asistana Sor</div>
                <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:12}}>
                  {["Bu hafta kapasitemi göster","Gecikme riski?","Stok ihtiyaç listesi","Bugün kim ne yapıyor?"].map((q,i)=>(
                    <button key={i} className="btn-g" style={{borderRadius:100,padding:"5px 12px",fontSize:12}}>{q}</button>
                  ))}
                </div>
                <div style={{display:"flex",gap:8}}>
                  <input placeholder="Sor… (örn: SP-042 ne zaman biter?)" style={{flex:1,padding:"11px 14px",
                    borderRadius:10,border:`1px solid ${C.border}`,background:"rgba(255,255,255,.04)",
                    color:C.text,fontSize:13,transition:"border-color .2s"}}
                    onFocus={e=>e.target.style.borderColor=`${C.cyan}50`}
                    onBlur={e=>e.target.style.borderColor=C.border}/>
                  <Btn variant="primary">Sor →</Btn>
                </div>
              </div>
            </div>
          )}

          {/* ─ ÜRÜNLER ─ */}
          {tab==="urunler"&&(
            <div style={{animation:"fade-up .35s ease"}}>
              <PageHeader title="Ürün Listesi" sub="Maliyet ve üretim reçeteleri"
                action={<div style={{display:"flex",gap:8}}>
                  <Btn onClick={()=>setModal({type:"otomatikKod",data:{}})}
                    style={{background:"rgba(139,92,246,.12)",border:"1px solid rgba(139,92,246,.3)",color:"#a78bfa"}}>
                    🤖 Kodları Otomatik Oluştur
                  </Btn>
                  <Btn variant="primary" onClick={()=>setModal({type:"yeniUrun",data:{}})}>+ Yeni Ürün</Btn>
                </div>}/>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10}}>
                {urunler.map((u,i)=>(
                  <div key={u.id} className="card" style={{background:"rgba(255,255,255,0.03)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:`1px solid ${C.border}`,
                    borderRadius:16,overflow:"hidden",cursor:"pointer",transition:"all .22s",
                    animation:`fade-up .3s ${i*.06}s ease both`}}
                    onClick={()=>{setAktifUrun(u.id);setTab("maliyet");setMalTab("ozet");}}>
                    <div style={{height:2,background:`linear-gradient(90deg,${C.cyan},${C.cyan}00)`}}/>
                    <div style={{padding:"16px 16px 14px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                        <div>
                          <div style={{fontSize:10,color:C.muted,marginBottom:2}}>{u.kod} · {u.kategori}</div>
                          <div style={{fontSize:15,fontWeight:700,color:C.text,fontFamily:F}}>{u.ad}</div>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontSize:18,fontWeight:800,color:C.cyan,fontFamily:F}}>{u.satisKdvDahil} ₺</div>
                          <div style={{fontSize:10,color:u.aktif?C.mint:C.muted}}>{u.aktif?"● Aktif":"● Pasif"}</div>
                        </div>
                      </div>
                      {/* BOM özet */}
                      {(u.bom||[]).length>0&&(
                        <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:8}}>
                          {(u.bom||[]).slice(0,3).map(b=>{
                            const k=[...hamMaddeler,...yarimamulList,...hizmetlerMerged].find(x=>x.id===b.kalemId);
                            const tc=b.tip==="hammadde"?C.sky:b.tip==="yarimamul"?C.cyan:C.lav;
                            return k?<span key={b.id} style={{background:`${tc}0D`,border:`1px solid ${tc}1A`,
                              borderRadius:5,padding:"2px 6px",fontSize:9,color:tc}}>
                              {k.ad.slice(0,12)}</span>:null;
                          })}
                          {(u.bom||[]).length>3&&<span style={{fontSize:9,color:C.muted}}>+{u.bom.length-3}</span>}
                        </div>
                      )}
                      {/* Maliyet özet */}
                      {(()=>{
                        const malBom=(u.bom||[]).reduce((s,b)=>{
                          const k=[...hamMaddeler,...yarimamulList,...hizmetlerMerged].find(x=>x.id===b.kalemId);
                          return s+(k?bomKalemMaliyet(k,b.miktar,b.birim,hamMaddeler,yarimamulList,hizmetlerMerged):0);
                        },0);
                        const kar=u.satisKdvDahil/(1+(u.satisKdv??10)/100)-malBom;
                        return malBom>0&&(
                          <div style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap"}}>
                            <span style={{fontSize:11,color:C.coral}}>Maliyet: {fmt(malBom)}₺</span>
                            <span style={{fontSize:11,color:kar>0?C.mint:C.coral}}>Kâr: {fmt(kar)}₺</span>
                            <span style={{fontSize:11,color:C.muted}}>Stok: {u.stok||0} adet</span>
                          </div>
                        );
                      })()}
                      <div style={{display:"flex",gap:7,alignItems:"center"}}>
                        <button onClick={e=>{e.stopPropagation();setModal({type:"urunDuzenle",data:u});}}
                          style={{background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:7,
                            padding:"5px 11px",fontSize:11,color:C.sub,cursor:"pointer"}}>Düzenle</button>
                        <button onClick={e=>{e.stopPropagation();setModal({type:"urunDuzenle",data:u});}}
                          style={{background:`${C.mint}12`,border:`1px solid ${C.mint}25`,borderRadius:7,
                            padding:"5px 11px",fontSize:11,fontWeight:600,color:C.mint,cursor:"pointer"}}>✏️ BOM Düzenle</button>
                        <button onClick={e=>{e.stopPropagation();setAktifUrun(u.id);setTab("maliyet");setMalTab("ozet");}}
                          style={{background:`${C.cyan}12`,border:`1px solid ${C.cyan}25`,borderRadius:7,
                            padding:"5px 11px",fontSize:11,fontWeight:600,color:C.cyan,cursor:"pointer"}}>Detay →</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─ MALİYET / REÇETE ─ */}
          {tab==="maliyet"&&(()=>{
            const u = urunler.find(x=>x.id===aktifUrun)||urunler[0];
            const recete = receteler[u?.id]||[];
            const toplamDk = recete.filter(r=>!r.fason).reduce((s,r)=>s+r.sureDk,0);
            return(
            <div style={{animation:"fade-up .35s ease"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,flexWrap:"wrap",gap:12}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <Btn onClick={()=>setTab("urunler")}>← Ürünler</Btn>
                  <div>
                    <div style={{fontSize:10,color:C.muted,marginBottom:2}}>{u?.kod} · {u?.kategori}</div>
                    <h1 style={{fontSize:28,fontWeight:800,color:C.text,fontFamily:F,letterSpacing:-1,margin:0}}>{u?.ad}</h1>
                  </div>
                </div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-start"}}>
                  {/* Maliyet + KDV Dahil — salt okunur */}
                  {[["Maliyet",`${fmt(totMatrah)} ₺`,C.coral],["KDV Dahil",`${fmt(totKdvDahil)} ₺`,C.gold]].map(([l,v,c])=>(
                    <div key={l} style={{background:`${c}0D`,border:`1px solid ${c}22`,borderRadius:10,padding:"7px 12px",textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted,marginBottom:1}}>{l}</div>
                      <div style={{fontSize:13,fontWeight:800,color:c,fontFamily:F}}>{v}</div>
                    </div>
                  ))}
                  {/* Satış fiyatı — çift yönlü editable */}
                  <div style={{background:`${C.cyan}0D`,border:`1px solid ${C.cyan}30`,borderRadius:10,padding:"6px 10px",minWidth:130}}>
                    <div style={{fontSize:9,color:C.muted,marginBottom:3}}>Satış Fiyatı (KDV %{aktifUrunObj?.satisKdv??10})</div>
                    <div style={{display:"flex",gap:4,alignItems:"center"}}>
                      <div style={{display:"flex",flexDirection:"column",gap:2}}>
                        <div style={{fontSize:8,color:C.muted}}>KDV Dahil</div>
                        <input type="number" step={1} min={0}
                          value={malParams.targetSaleKdvDahil??aktifUrunObj?.satisKdvDahil??0}
                          onChange={e=>{
                            const kdvDahil=parseFloat(e.target.value)||0;
                            setMalParams(p=>({...p,targetSaleKdvDahil:kdvDahil}));
                            setUrunler(prev=>prev.map(x=>x.id===aktifUrunObj?.id?{...x,satisKdvDahil:kdvDahil}:x));
                          }}
                          className="inp" style={{width:75,background:"rgba(255,255,255,.06)",border:`1px solid ${C.cyan}40`,
                          borderRadius:6,padding:"3px 7px",fontSize:13,fontWeight:800,color:C.cyan,textAlign:"right"}}/>
                      </div>
                      <div style={{color:C.muted,fontSize:10,alignSelf:"flex-end",paddingBottom:3}}>⇄</div>
                      <div style={{display:"flex",flexDirection:"column",gap:2}}>
                        <div style={{fontSize:8,color:C.muted}}>KDV Hariç</div>
                        <input type="number" step={1} min={0}
                          value={Math.round(((malParams.targetSaleKdvDahil??aktifUrunObj?.satisKdvDahil??0)/(1+(aktifUrunObj?.satisKdv??10)/100))*100)/100}
                          onChange={e=>{
                            const net=parseFloat(e.target.value)||0;
                            const kdvDahil=Math.round(net*(1+(aktifUrunObj?.satisKdv??10)/100)*100)/100;
                            setMalParams(p=>({...p,targetSaleKdvDahil:kdvDahil}));
                            setUrunler(prev=>prev.map(x=>x.id===aktifUrunObj?.id?{...x,satisKdvDahil:kdvDahil}:x));
                          }}
                          className="inp" style={{width:75,background:"rgba(255,255,255,.04)",border:`1px solid ${C.cyan}25`,
                          borderRadius:6,padding:"3px 7px",fontSize:12,fontWeight:600,color:C.sub,textAlign:"right"}}/>
                      </div>
                    </div>
                  </div>
                  {/* Net Kar + Marj */}
                  {[["Net Kar",`${fmt(netKar)} ₺`,netKar>0?C.mint:C.coral],
                    ["Net Marj",`%${fmt(netPct,1)}`,netPct>15?C.mint:C.gold]].map(([l,v,c])=>(
                    <div key={l} style={{background:`${c}0D`,border:`1px solid ${c}22`,borderRadius:10,padding:"7px 12px",textAlign:"center"}}>
                      <div style={{fontSize:9,color:C.muted,marginBottom:1}}>{l}</div>
                      <div style={{fontSize:13,fontWeight:800,color:c,fontFamily:F}}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Tabs */}
              <div style={{display:"flex",gap:3,marginBottom:18,background:"rgba(255,255,255,0.02)",padding:3,
                borderRadius:11,width:"fit-content",border:`1px solid ${C.border}`}}>
                {[["akis","🔗 Üretim Akış Haritası"],["ozet","📊 Üretim Özeti"],["kartlar","Maliyet Kartları"],["analiz","Kar Analizi"],["kdv","KDV Özeti"]].map(([id,lbl])=>(
                  <button key={id} className="tab-b" onClick={()=>setMalTab(id)} style={{
                    padding:"7px 15px",borderRadius:8,border:"none",cursor:"pointer",fontFamily:FB,
                    background:malTab===id?C.s3:"transparent",color:malTab===id?C.text:C.muted,
                    fontSize:12,fontWeight:malTab===id?600:400,transition:"all .15s",
                    boxShadow:malTab===id?`0 2px 6px rgba(0,0,0,.3),inset 0 1px 0 ${C.borderHi}`:"none"}}>
                    {lbl}
                  </button>
                ))}
              </div>



              {/* ── İNTERAKTİF ÜRETİM AKIŞ HARİTASI ── */}
              {malTab==="akis"&&(()=>{
                const allKalemler = [...hamMaddeler,...yarimamulList,...hizmetlerMerged];
                const mevcutAkis = u?.uretimAkis || [];

                // BOM'dan otomatik akış oluştur
                const otomatikAkisOlustur = () => {
                  const adimlar = [];
                  const bom = u?.bom || [];
                  let sira = 1;
                  // Ham maddeler → tedarik düğümü
                  const hmler = bom.filter(b=>b.tip==="hammadde");
                  if(hmler.length>0){
                    adimlar.push({
                      id:uid(), tip:"tedarik", sira:sira++,
                      ad:"Ham Madde Tedarik",
                      kalemIds:hmler.map(b=>b.kalemId),
                      girdiIds:[], ciktiAd:"Ham Maddeler",
                      fasonFirmaId:null, gunlukKapasite:0, sureSaat:0, notlar:"",
                    });
                  }
                  // Hizmetleri rekürsif topla
                  const eklenen = new Set();
                  const hizmetTopla = (bomList, depth=0) => {
                    if(depth>6) return;
                    (bomList||[]).forEach(b=>{
                      if(b.tip==="hizmet"){
                        const hz = allKalemler.find(x=>x.id===b.kalemId);
                        if(hz && !eklenen.has(hz.id)){
                          eklenen.add(hz.id);
                          adimlar.push({
                            id:uid(), tip:hz.tip==="fason"?"fason":"ic_iscilik", sira:sira++,
                            ad:hz.ad, kalemIds:[hz.id],
                            girdiIds:adimlar.length>0?[adimlar[adimlar.length-1].id]:[],
                            ciktiAd:"", fasonFirmaId:hz.tip==="fason"?hz.id:null,
                            gunlukKapasite:hz.gunlukKapasite||0,
                            sureSaat:hz.tip==="fason"?(hz.sureGun||0)*8:(hz.sureDkAdet||0)/3600,
                            notlar:"",
                          });
                        }
                      } else if(b.tip==="yarimamul"){
                        const ym = yarimamulList.find(x=>x.id===b.kalemId);
                        hizmetTopla(ym?.bom||[], depth+1);
                      }
                    });
                  };
                  bom.filter(b=>b.tip==="yarimamul").forEach(b=>{
                    const ym = yarimamulList.find(x=>x.id===b.kalemId);
                    hizmetTopla(ym?.bom||[], 1);
                  });
                  bom.filter(b=>b.tip==="hizmet").forEach(b=>hizmetTopla([b]));
                  return adimlar;
                };

                const akis = mevcutAkis.length>0 ? mevcutAkis : otomatikAkisOlustur();
                const kaydet = (yeniAkis) => setUrunler(p=>p.map(x=>x.id===u.id?{...x,uretimAkis:yeniAkis}:x));

                // Düğüm renk/ikon sabitleri
                const TIP = {
                  tedarik:{renk:C.sky,ikon:"📦",label:"Tedarik",bg:"rgba(62,123,212,.08)"},
                  fason:{renk:C.lav,ikon:"🏭",label:"Fason",bg:"rgba(124,92,191,.08)"},
                  ic_iscilik:{renk:C.gold,ikon:"👷",label:"İç İşçilik",bg:"rgba(200,135,42,.08)"},
                  yarimamul:{renk:C.cyan,ikon:"⚙️",label:"Yarı Mamül",bg:"rgba(232,145,74,.08)"},
                };

                // Sürükle-bırak sıralama
                const tasiAdim = (fromIdx, toIdx) => {
                  const arr = [...akis];
                  const [moved] = arr.splice(fromIdx, 1);
                  arr.splice(toIdx, 0, moved);
                  kaydet(arr.map((a,i)=>({...a, sira:i+1, girdiIds:i>0?[arr[i-1].id]:[]})));
                };
                const silAdim = (id) => kaydet(akis.filter(a=>a.id!==id).map((a,i)=>({...a,sira:i+1})));
                const adimGuncelle = (id, field, value) => kaydet(akis.map(a=>a.id===id?{...a,[field]:value}:a));

                // Yeni adım ekle
                const yeniAdimEkle = (tip, kalemId=null) => {
                  const kalem = kalemId ? allKalemler.find(x=>x.id===kalemId) : null;
                  const yeni = {
                    id:uid(), tip, sira:akis.length+1,
                    ad: kalem?.ad || (tip==="tedarik"?"Tedarik":tip==="fason"?"Fason İşlem":"İç İşlem"),
                    kalemIds: kalemId?[kalemId]:[],
                    girdiIds: akis.length>0?[akis[akis.length-1].id]:[],
                    ciktiAd:"", fasonFirmaId:tip==="fason"?(kalemId||null):null,
                    gunlukKapasite:kalem?.gunlukKapasite||0,
                    sureSaat:tip==="fason"?(kalem?.sureGun||0)*8:(kalem?.sureDkAdet||0)/3600,
                    notlar:"",
                  };
                  kaydet([...akis, yeni]);
                };

                // Toplam süre
                const topFasonGun = akis.filter(a=>a.tip==="fason").reduce((s,a)=>s+(a.sureSaat||0)/8,0);
                const topIcSaat = akis.filter(a=>a.tip==="ic_iscilik").reduce((s,a)=>s+(a.sureSaat||0),0);

                // Seçili düğüm (detay paneli için)
                // IIFE içinde useState yasak — basit toggle ile açalım

                return(
                  <div>
                    {/* Üst araç çubuğu */}
                    <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
                      <div style={{display:"flex",gap:6,flex:1,flexWrap:"wrap"}}>
                        {[
                          {l:"Adım",v:akis.length,c:C.text},
                          {l:"Fason",v:`${akis.filter(a=>a.tip==="fason").length} (~${topFasonGun.toFixed(0)}g)`,c:C.lav},
                          {l:"İç İşçilik",v:`${akis.filter(a=>a.tip==="ic_iscilik").length} (~${topIcSaat.toFixed(1)}sa)`,c:C.gold},
                        ].map((k,i)=>(
                          <div key={i} style={{background:`${k.c}0C`,border:`1px solid ${k.c}20`,borderRadius:8,
                            padding:"6px 12px",display:"flex",alignItems:"center",gap:4}}>
                            <span style={{fontSize:13,fontWeight:700,color:k.c,fontFamily:F}}>{k.v}</span>
                            <span style={{fontSize:9,color:C.muted}}>{k.l}</span>
                          </div>
                        ))}
                      </div>
                      <button onClick={()=>{kaydet(otomatikAkisOlustur());}}
                        style={{background:`${C.cyan}10`,border:`1px solid ${C.cyan}25`,borderRadius:8,
                          padding:"7px 14px",fontSize:11,fontWeight:600,color:C.cyan,cursor:"pointer"}}>
                        🔄 BOM'dan Yeniden Oluştur
                      </button>
                    </div>

                    {/* Ana alan: Ağaç + Palet yan yana */}
                    <div style={{display:"grid",gridTemplateColumns:"1fr 220px",gap:14,alignItems:"start"}}>

                      {/* SOL: Akış Ağacı */}
                      <div style={{background:"rgba(255,255,255,.015)",border:`1px solid ${C.border}`,
                        borderRadius:16,padding:"16px",minHeight:400,position:"relative"}}>

                        {/* Dikey bağlantı çizgisi */}
                        {akis.length>1&&(
                          <div style={{position:"absolute",left:35,top:60,bottom:80,width:2,
                            background:`linear-gradient(180deg,${C.sky}60,${C.lav}60,${C.gold}60,${C.mint}60)`,
                            borderRadius:2,zIndex:0}}/>
                        )}

                        {/* Başlangıç düğümü */}
                        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8,position:"relative",zIndex:1}}>
                          <div style={{width:32,height:32,borderRadius:"50%",background:"rgba(255,255,255,.06)",
                            border:`2px solid ${C.muted}`,display:"flex",alignItems:"center",justifyContent:"center",
                            fontSize:14,flexShrink:0}}>🏗️</div>
                          <div style={{fontSize:12,fontWeight:700,color:C.muted}}>Üretim Başlangıcı</div>
                        </div>

                        {/* Akış düğümleri */}
                        {akis.map((adim,ai)=>{
                          const t = TIP[adim.tip]||TIP.ic_iscilik;
                          const fasonHz = adim.fasonFirmaId ? allKalemler.find(x=>x.id===adim.fasonFirmaId) : null;
                          const kalemAdlari = (adim.kalemIds||[]).map(kid=>{
                            const k=allKalemler.find(x=>x.id===kid);
                            return k?.ad||"?";
                          });
                          return(
                            <div key={adim.id}
                              draggable
                              onDragStart={e=>{e.dataTransfer.setData("akisIdx",String(ai));e.currentTarget.style.opacity=".5";}}
                              onDragEnd={e=>{e.currentTarget.style.opacity="1";}}
                              onDragOver={e=>e.preventDefault()}
                              onDrop={e=>{
                                e.preventDefault();
                                const from=parseInt(e.dataTransfer.getData("akisIdx"));
                                if(!isNaN(from)&&from!==ai) tasiAdim(from,ai);
                              }}
                              style={{display:"flex",gap:12,marginBottom:6,position:"relative",zIndex:1,
                                animation:`fade-up .25s ${ai*.04}s ease both`,cursor:"grab"}}>

                              {/* Sol düğüm noktası */}
                              <div style={{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0,width:32}}>
                                <div style={{width:28,height:28,borderRadius:"50%",background:t.bg,
                                  border:`2px solid ${t.renk}`,display:"flex",alignItems:"center",
                                  justifyContent:"center",fontSize:13,boxShadow:`0 0 8px ${t.renk}30`}}>
                                  {t.ikon}
                                </div>
                              </div>

                              {/* Kart */}
                              <div style={{flex:1,background:t.bg,border:`1px solid ${t.renk}30`,
                                borderRadius:12,overflow:"hidden",transition:"all .15s"}}
                                onMouseEnter={e=>{e.currentTarget.style.borderColor=t.renk+"60";e.currentTarget.style.boxShadow=`0 4px 16px ${t.renk}20`;}}
                                onMouseLeave={e=>{e.currentTarget.style.borderColor=t.renk+"30";e.currentTarget.style.boxShadow="none";}}>

                                {/* Üst renk şerit */}
                                <div style={{height:2,background:`linear-gradient(90deg,${t.renk},${t.renk}40)`}}/>

                                <div style={{padding:"10px 14px"}}>
                                  {/* Başlık satırı */}
                                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                                    <div style={{flex:1,minWidth:0}}>
                                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                                        <span style={{fontSize:8,background:`${t.renk}20`,color:t.renk,borderRadius:3,
                                          padding:"1px 5px",fontWeight:800,textTransform:"uppercase"}}>{t.label}</span>
                                        <span style={{fontSize:9,color:C.muted}}>#{adim.sira}</span>
                                      </div>
                                      {/* Düzenlenebilir ad */}
                                      <input value={adim.ad} onChange={e=>adimGuncelle(adim.id,"ad",e.target.value)}
                                        style={{fontSize:13,fontWeight:700,color:C.text,background:"transparent",
                                          border:"none",padding:0,width:"100%",fontFamily:F,outline:"none"}}/>
                                    </div>
                                    {/* Sıra + Sil butonları */}
                                    <div style={{display:"flex",gap:3,flexShrink:0}}>
                                      {ai>0&&<button onClick={()=>tasiAdim(ai,ai-1)}
                                        style={{width:22,height:22,borderRadius:5,border:`1px solid ${C.border}`,
                                          background:"rgba(255,255,255,.04)",color:C.muted,fontSize:10,
                                          cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>▲</button>}
                                      {ai<akis.length-1&&<button onClick={()=>tasiAdim(ai,ai+1)}
                                        style={{width:22,height:22,borderRadius:5,border:`1px solid ${C.border}`,
                                          background:"rgba(255,255,255,.04)",color:C.muted,fontSize:10,
                                          cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>▼</button>}
                                      <button onClick={()=>silAdim(adim.id)}
                                        style={{width:22,height:22,borderRadius:5,border:`1px solid ${C.coral}25`,
                                          background:`${C.coral}08`,color:C.coral,fontSize:10,
                                          cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
                                    </div>
                                  </div>

                                  {/* Kalem listesi */}
                                  {kalemAdlari.length>0&&(
                                    <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:4}}>
                                      {kalemAdlari.map((ad2,ki)=>(
                                        <span key={ki} style={{fontSize:9,background:`${t.renk}12`,color:t.renk,
                                          borderRadius:4,padding:"1px 6px"}}>{ad2}</span>
                                      ))}
                                    </div>
                                  )}

                                  {/* Fason detay */}
                                  {adim.tip==="fason"&&(
                                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:6,fontSize:9}}>
                                      {fasonHz?.firma&&<span style={{color:C.lav}}>🏭 {fasonHz.firma}</span>}
                                      {adim.gunlukKapasite>0&&<span style={{color:C.lav}}>📊 {adim.gunlukKapasite}/gün</span>}
                                      {fasonHz?.oncedenHaberGun>0&&<span style={{color:C.gold}}>📢 {fasonHz.oncedenHaberGun}g haber</span>}
                                      {fasonHz?.birimFiyat>0&&<span style={{color:C.cyan}}>💰 {fasonHz.birimFiyat}₺</span>}
                                      {adim.sureSaat>0&&<span style={{color:C.muted}}>⏱ ~{(adim.sureSaat/8).toFixed(0)}g</span>}
                                    </div>
                                  )}

                                  {/* İç işçilik detay */}
                                  {adim.tip==="ic_iscilik"&&adim.sureSaat>0&&(
                                    <div style={{fontSize:9,color:C.gold,marginTop:4}}>
                                      ⏱ {adim.sureSaat>=1?`~${adim.sureSaat.toFixed(1)} saat`:`~${(adim.sureSaat*60).toFixed(0)} dk`}/adet
                                    </div>
                                  )}

                                  {/* Çıktı adı (düzenlenebilir) */}
                                  <div style={{marginTop:6,display:"flex",alignItems:"center",gap:6}}>
                                    <span style={{fontSize:9,color:C.muted}}>Çıktı:</span>
                                    <input value={adim.ciktiAd||""} onChange={e=>adimGuncelle(adim.id,"ciktiAd",e.target.value)}
                                      placeholder="Ara parça, iskelet..."
                                      style={{fontSize:10,color:C.mint,background:"transparent",border:"none",
                                        borderBottom:`1px dashed ${C.border}`,padding:"1px 4px",outline:"none",flex:1}}/>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        {/* Bitiş düğümü */}
                        <div style={{display:"flex",alignItems:"center",gap:12,marginTop:8,position:"relative",zIndex:1}}>
                          <div style={{width:32,height:32,borderRadius:"50%",background:`${C.mint}15`,
                            border:`2px solid ${C.mint}`,display:"flex",alignItems:"center",justifyContent:"center",
                            fontSize:14,flexShrink:0,boxShadow:`0 0 12px ${C.mint}30`}}>✅</div>
                          <div>
                            <div style={{fontSize:13,fontWeight:700,color:C.mint}}>{u?.ad||"Bitmiş Ürün"}</div>
                            <div style={{fontSize:10,color:C.muted}}>Depoya / Sevkiyata hazır</div>
                          </div>
                        </div>

                        {/* Boş durum */}
                        {akis.length===0&&(
                          <div style={{textAlign:"center",padding:"40px 20px",color:C.muted}}>
                            <div style={{fontSize:32,marginBottom:8}}>🔗</div>
                            <div style={{fontSize:12,marginBottom:12}}>Henüz akış adımı yok</div>
                            <div style={{fontSize:11}}>Sağdaki panelden sürükleyerek veya "BOM'dan Oluştur" butonuyla başla</div>
                          </div>
                        )}
                      </div>

                      {/* SAĞ: Malzeme & İşlem Paleti */}
                      <div style={{display:"flex",flexDirection:"column",gap:8}}>

                        {/* Hızlı ekle butonları */}
                        <div style={{background:"rgba(255,255,255,.02)",border:`1px solid ${C.border}`,
                          borderRadius:12,padding:"10px"}}>
                          <div style={{fontSize:9,fontWeight:700,color:C.muted,letterSpacing:1,
                            textTransform:"uppercase",marginBottom:8}}>+ Adım Ekle</div>
                          {[
                            {tip:"tedarik",label:"📦 Tedarik Adımı",renk:C.sky},
                            {tip:"fason",label:"🏭 Fason İşlem",renk:C.lav},
                            {tip:"ic_iscilik",label:"👷 İç İşçilik",renk:C.gold},
                          ].map(b=>(
                            <button key={b.tip} onClick={()=>yeniAdimEkle(b.tip)}
                              style={{display:"block",width:"100%",textAlign:"left",padding:"7px 10px",
                                marginBottom:4,borderRadius:8,border:`1px solid ${b.renk}25`,
                                background:`${b.renk}08`,color:b.renk,fontSize:11,fontWeight:600,
                                cursor:"pointer",transition:"all .15s"}}
                              onMouseEnter={e=>{e.currentTarget.style.background=`${b.renk}18`;}}
                              onMouseLeave={e=>{e.currentTarget.style.background=`${b.renk}08`;}}>{b.label}</button>
                          ))}
                        </div>

                        {/* BOM'daki fason hizmetler */}
                        {hizmetlerMerged.filter(h=>h.tip==="fason").length>0&&(
                          <div style={{background:`${C.lav}06`,border:`1px solid ${C.lav}18`,
                            borderRadius:12,padding:"10px"}}>
                            <div style={{fontSize:9,fontWeight:700,color:C.lav,letterSpacing:1,
                              textTransform:"uppercase",marginBottom:8}}>🏭 Fason Firmalar</div>
                            {hizmetlerMerged.filter(h=>h.tip==="fason").map(hz=>(
                              <button key={hz.id} onClick={()=>yeniAdimEkle("fason",hz.id)}
                                draggable
                                onDragStart={e=>{e.dataTransfer.setData("paletTip","fason");e.dataTransfer.setData("paletKalemId",hz.id);}}
                                style={{display:"block",width:"100%",textAlign:"left",padding:"6px 8px",
                                  marginBottom:3,borderRadius:7,border:`1px solid ${C.lav}20`,
                                  background:"rgba(255,255,255,.02)",color:C.text,fontSize:10,
                                  cursor:"grab",transition:"all .12s"}}
                                onMouseEnter={e=>{e.currentTarget.style.background=`${C.lav}12`;}}
                                onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.02)";}}>
                                <div style={{fontWeight:600}}>{hz.ad}</div>
                                <div style={{fontSize:8,color:C.muted,marginTop:1}}>
                                  {hz.firma||""}{hz.gunlukKapasite>0?` · ${hz.gunlukKapasite}/gün`:""}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}

                        {/* BOM'daki iç işçilikler */}
                        {hizmetlerMerged.filter(h=>h.tip==="ic").length>0&&(
                          <div style={{background:`${C.gold}06`,border:`1px solid ${C.gold}18`,
                            borderRadius:12,padding:"10px"}}>
                            <div style={{fontSize:9,fontWeight:700,color:C.gold,letterSpacing:1,
                              textTransform:"uppercase",marginBottom:8}}>👷 İç İşçilikler</div>
                            {hizmetlerMerged.filter(h=>h.tip==="ic").map(hz=>(
                              <button key={hz.id} onClick={()=>yeniAdimEkle("ic_iscilik",hz.id)}
                                draggable
                                onDragStart={e=>{e.dataTransfer.setData("paletTip","ic_iscilik");e.dataTransfer.setData("paletKalemId",hz.id);}}
                                style={{display:"block",width:"100%",textAlign:"left",padding:"6px 8px",
                                  marginBottom:3,borderRadius:7,border:`1px solid ${C.gold}20`,
                                  background:"rgba(255,255,255,.02)",color:C.text,fontSize:10,
                                  cursor:"grab",transition:"all .12s"}}
                                onMouseEnter={e=>{e.currentTarget.style.background=`${C.gold}12`;}}
                                onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.02)";}}>
                                <div style={{fontWeight:600}}>{hz.ad}</div>
                                <div style={{fontSize:8,color:C.muted,marginTop:1}}>
                                  {hz.istasyon||""}{hz.sureDkAdet>0?` · ${hz.sureDkAdet>=60?Math.floor(hz.sureDkAdet/60)+"dk":hz.sureDkAdet+"sn"}`:""}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Ham maddeler */}
                        {hamMaddeler.length>0&&(
                          <div style={{background:`${C.sky}06`,border:`1px solid ${C.sky}18`,
                            borderRadius:12,padding:"10px",maxHeight:160,overflowY:"auto"}}>
                            <div style={{fontSize:9,fontWeight:700,color:C.sky,letterSpacing:1,
                              textTransform:"uppercase",marginBottom:8}}>📦 Ham Maddeler</div>
                            {hamMaddeler.slice(0,10).map(hm=>(
                              <div key={hm.id} style={{padding:"4px 8px",marginBottom:2,borderRadius:5,
                                background:"rgba(255,255,255,.02)",fontSize:10,color:C.sub}}>
                                {hm.ad}
                                <span style={{fontSize:8,color:C.muted,marginLeft:4}}>{hm.miktar} {hm.birim}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}


              {malTab==="ozet"&&(()=>{
                const bomRows = u?.bom || [];
                const allKalemler = [...hamMaddeler, ...yarimamulList, ...hizmetlerMerged];

                // ── Üst BOM'u zenginleştir ──────────────────────────────────────
                const zenginBom = bomRows.map(b=>{
                  const kalem = allKalemler.find(x=>x.id===b.kalemId) || null;
                  const maliyet = kalem
                    ? _bomKalemMaliyet(kalem, b.miktar, b.birim, hamMaddeler, yarimamulList, hizmetlerMerged, 0, b.fireTahmini||0)
                    : 0;
                  return {...b, kalem, maliyet};
                });

                // ── Üst BOM grupları ─────────────────────────────────────────────
                const hamGrup   = zenginBom.filter(b=>b.tip==="hammadde");
                const ymGrup    = zenginBom.filter(b=>b.tip==="yarimamul");
                const fasonGrup = zenginBom.filter(b=>b.tip==="hizmet"&&b.kalem?.tip==="fason");
                const icGrup    = zenginBom.filter(b=>b.tip==="hizmet"&&b.kalem?.tip==="ic");

                // ── YM içi hizmetleri rekürsif topla (carpan ile) ─────────────────
                // carpan: bu YM kaç adet kullanılıyor (üst BOM'daki miktar)
                const ymHizmetleriTopla = (ymBom, carpan=1, derinlik=0) => {
                  if(derinlik>8 || !ymBom?.length) return [];
                  return ymBom.flatMap(b2=>{
                    const k2 = allKalemler.find(x=>x.id===b2.kalemId) || null;
                    if(b2.tip==="hizmet"){
                      // Maliyet = 1 adet YM için hesapla, sonra carpan ile çarp
                      const m1 = k2 ? _bomKalemMaliyet(k2, b2.miktar, b2.birim, hamMaddeler, yarimamulList, hizmetlerMerged) : 0;
                      return [{...b2, kalem:k2, maliyet: m1 * carpan}];
                    }
                    if(b2.tip==="yarimamul"){
                      const ym2 = yarimamulList.find(x=>x.id===b2.kalemId);
                      return ymHizmetleriTopla(ym2?.bom||[], (b2.miktar||1)*carpan, derinlik+1);
                    }
                    return [];
                  });
                };

                // Tüm YM'lerin içindeki hizmetleri topla
                const ymHizmetler = ymGrup.flatMap(b=>{
                  const ymK = yarimamulList.find(x=>x.id===b.kalemId);
                  return ymHizmetleriTopla(ymK?.bom||[], b.miktar||1);
                });

                // Fason = üst BOM + YM içi fasonlar
                const tumFasonlar = [
                  ...fasonGrup,
                  ...ymHizmetler.filter(b=>b.kalem?.tip==="fason"),
                ];
                // İç işçilik = üst BOM + YM içi iç işçilikler
                const tumIcIsci = [
                  ...icGrup,
                  ...ymHizmetler.filter(b=>b.kalem?.tip==="ic"),
                ];

                // ── Toplam maliyet: üst BOM toplamı = tam maliyet (YM rekürsif dahil) ──
                const genelToplam    = zenginBom.reduce((s,b)=>s+(b.maliyet||0), 0);
                const toplamMal      = [...hamGrup,...ymGrup].reduce((s,b)=>s+(b.maliyet||0), 0);
                const toplamFasonGoster = tumFasonlar.reduce((s,b)=>s+(b.maliyet||0), 0);
                const toplamIsciGoster  = tumIcIsci.reduce((s,b)=>s+(b.maliyet||0), 0);

                // ── Süre: sureDkAdet SANİYE cinsinden ───────────────────────────
                // Üst BOM + YM içi işçilikler hepsi saniye cinsinden
                const getSureSn = (b) => (b.kalem?.sureDkAdet || 0) * (b.miktar||1);
                // tumIcIsci içindeki maliyet zaten carpan ile çarpılmış
                // Süre de carpan ile çarpılmalı — b.maliyet / (birimFiyat/3600) hesabı yerine
                // direkt sureDkAdet × miktar × carpan kullan
                const ymHizSureler = ymGrup.flatMap(b=>{
                  const ymK = yarimamulList.find(x=>x.id===b.kalemId);
                  const topla2 = (ymBom, carpan=1, d=0) => {
                    if(d>8||!ymBom?.length) return [];
                    return ymBom.flatMap(b2=>{
                      const k2 = allKalemler.find(x=>x.id===b2.kalemId);
                      if(b2.tip==="hizmet"&&k2?.tip==="ic")
                        return [(b2.miktar||1)*(k2.sureDkAdet||0)*carpan];
                      if(b2.tip==="yarimamul"){
                        const ym2=yarimamulList.find(x=>x.id===b2.kalemId);
                        return topla2(ym2?.bom||[],(b2.miktar||1)*carpan,d+1);
                      }
                      return [];
                    });
                  };
                  return topla2(ymK?.bom||[], b.miktar||1);
                });
                const ustIsciSureler = icGrup.map(b=>(b.kalem?.sureDkAdet||0)*(b.miktar||1));
                const tumSureler = [...ustIsciSureler, ...ymHizSureler].filter(s=>s>0);
                const toplamSn   = tumSureler.reduce((s,v)=>s+v, 0);  // saniye
                const darbogazSn = tumSureler.length>0 ? Math.max(...tumSureler) : 0;
                const gunlukKapasite = toplamSn>0 ? Math.floor(28800/toplamSn) : null;

                // ── YM detay (OzetGrupKart için) ─────────────────────────────────
                const ymDetay = (ym) => {
                  const ymKalem = yarimamulList.find(x=>x.id===ym.kalemId);
                  if(!ymKalem?.bom?.length) return [];
                  return ymKalem.bom.map(b2=>{
                    const k2 = allKalemler.find(x=>x.id===b2.kalemId);
                    const m2 = k2 ? _bomKalemMaliyet(k2, b2.miktar, b2.birim, hamMaddeler, yarimamulList, hizmetlerMerged) : 0;
                    return {...b2, kalem:k2, maliyet:m2};
                  });
                };

                return(
                  <div>
                    {/* Üst metrik kutuları */}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:10,marginBottom:20}}>
                      {[
                        {l:"Toplam Maliyet",v:`${fmt(genelToplam)}₺`,c:C.coral,ikon:"💰"},
                        {l:"Malzeme+YM",    v:`${fmt(toplamMal)}₺`,c:C.sky,ikon:"🏗️",
                          alt:`%${genelToplam>0?fmt(toplamMal/genelToplam*100,1):0}`},
                        {l:"Fason",         v:`${fmt(toplamFasonGoster)}₺`,c:C.lav,ikon:"🏭",
                          alt:`%${genelToplam>0?fmt(toplamFasonGoster/genelToplam*100,1):0}`},
                        {l:"İç İşçilik",    v:`${fmt(toplamIsciGoster)}₺`,c:C.gold,ikon:"👤",
                          alt:`%${genelToplam>0?fmt(toplamIsciGoster/genelToplam*100,1):0}`},
                        ...(toplamSn>0?[
                          {l:"Toplam İşçilik Süresi",v:snGoster(toplamSn),c:C.mint,ikon:"⏱️",
                            alt:`${fmt(toplamSn/3600,2)} saat / ürün`},
                        ]:[]),
                        ...(gunlukKapasite?[
                          {l:"Günlük Kapasite",v:`${gunlukKapasite} adet`,c:C.cyan,ikon:"📈",
                            alt:`8 saat vardiya · darboğaz: ${snGoster(darbogazSn)}`},
                        ]:[]),
                      ].map((m,i)=>(
                        <div key={i} style={{background:`${m.c}0C`,border:`1px solid ${m.c}25`,borderRadius:12,padding:"12px 14px"}}>
                          <div style={{fontSize:18,marginBottom:4}}>{m.ikon}</div>
                          <div style={{fontSize:11,color:C.muted,marginBottom:3}}>{m.l}</div>
                          <div style={{fontSize:22,fontWeight:800,color:m.c,fontFamily:F,letterSpacing:"-.5px"}}>{m.v}</div>
                          {m.alt&&<div style={{fontSize:10,color:C.muted,marginTop:1}}>{m.alt}</div>}
                        </div>
                      ))}
                    </div>

                    {/* Dağılım barı */}
                    {genelToplam>0&&(
                      <div style={{marginBottom:18}}>
                        <div style={{fontSize:11,color:C.muted,marginBottom:5}}>Maliyet Dağılımı</div>
                        <div style={{display:"flex",height:8,borderRadius:6,overflow:"hidden",gap:1}}>
                          {[[toplamMal,C.sky,"Malzeme"],[toplamFasonGoster,C.lav,"Fason"],[toplamIsciGoster,C.gold,"İşçilik"]].map(([v,c,l])=>
                            v>0&&<div key={l} title={`${l}: ${fmt(v)}₺`} style={{flex:v,background:c}}/>
                          )}
                        </div>
                        <div style={{display:"flex",gap:12,marginTop:5}}>
                          {[[toplamMal,C.sky,"🏗️ Malzeme"],[toplamFasonGoster,C.lav,"🏭 Fason"],[toplamIsciGoster,C.gold,"👤 İşçilik"]].map(([v,c,l])=>
                            v>0&&<span key={l} style={{fontSize:10,color:c}}>
                              <span style={{display:"inline-block",width:6,height:6,borderRadius:2,background:c,marginRight:3}}/>
                              {l} {fmt(v)}₺
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Grup kartları — tıklanabilir */}
                    {ymGrup.length>0&&<OzetGrupKart baslik="Yarı Mamüller" renk={C.cyan} ikon="⚙️" satirlar={ymGrup} toplam={ymGrup.reduce((s,b)=>s+b.maliyet,0)} genelToplam={genelToplam} ymDetayFn={ymDetay} hamMaddeler={hamMaddeler} yarimamulList={yarimamulList} hizmetlerMerged={hizmetlerMerged}/>}
                    {hamGrup.length>0&&<OzetGrupKart baslik="Ham Maddeler" renk={C.sky} ikon="🧱" satirlar={hamGrup} toplam={hamGrup.reduce((s,b)=>s+b.maliyet,0)} genelToplam={genelToplam} hamMaddeler={hamMaddeler} yarimamulList={yarimamulList} hizmetlerMerged={hizmetlerMerged}/>}
                    {tumFasonlar.length>0&&<OzetGrupKart baslik="Fason İşçilik" renk={C.lav} ikon="🏭" satirlar={tumFasonlar} toplam={toplamFasonGoster} genelToplam={genelToplam} hamMaddeler={hamMaddeler} yarimamulList={yarimamulList} hizmetlerMerged={hizmetlerMerged}/>}
                    {tumIcIsci.length>0&&<OzetGrupKart baslik="İç İşçilik" renk={C.gold} ikon="👤" satirlar={tumIcIsci} toplam={toplamIsciGoster} genelToplam={genelToplam} hamMaddeler={hamMaddeler} yarimamulList={yarimamulList} hizmetlerMerged={hizmetlerMerged}/>}

                    {zenginBom.length===0&&(
                      <div style={{textAlign:"center",padding:"40px",color:C.muted,fontSize:13}}>
                        <div style={{fontSize:32,marginBottom:12}}>📦</div>
                        Bu ürün için BOM tanımlı değil.
                        <br/>
                        <button onClick={()=>setModal({type:"urunDuzenle",data:u})}
                          style={{marginTop:10,background:`${C.cyan}15`,border:`1px solid ${C.cyan}30`,
                          borderRadius:8,padding:"6px 14px",fontSize:12,color:C.cyan,cursor:"pointer"}}>
                          ✏️ BOM Ekle →
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {malTab==="kartlar"&&(()=>{
                if(bomZengin.length===0) return(
                  <div style={{textAlign:"center",padding:"48px",color:C.muted}}>
                    <div style={{fontSize:32,marginBottom:12}}>📦</div>
                    <div style={{fontSize:14,marginBottom:8}}>Bu ürün için BOM tanımlı değil.</div>
                    <button onClick={()=>setModal({type:"urunDuzenle",data:aktifUrunObj})}
                      style={{background:`${C.cyan}15`,border:`1px solid ${C.cyan}30`,borderRadius:9,
                      padding:"8px 18px",fontSize:12,color:C.cyan,cursor:"pointer",fontWeight:600}}>
                      ✏️ BOM Ekle →
                    </button>
                  </div>
                );

                // BOM'u kategorilere grupla
                const gruplar = [
                  {id:"yarimamul", label:"Yarı Mamüller",    ikon:"⚙️", renk:C.cyan,  satirlar:bomZengin.filter(b=>b.tip==="yarimamul")},
                  {id:"hammadde",  label:"Ham Maddeler",     ikon:"🧱", renk:C.sky,   satirlar:bomZengin.filter(b=>b.tip==="hammadde")},
                  {id:"fason",     label:"Fason İşçilik",    ikon:"🏭", renk:C.lav,   satirlar:bomZengin.filter(b=>b.tip==="hizmet"&&b.kalem?.tip==="fason")},
                  {id:"ic",        label:"İç İşçilik",       ikon:"👤", renk:C.gold,  satirlar:bomZengin.filter(b=>b.tip==="hizmet"&&b.kalem?.tip==="ic")},
                ].filter(g=>g.satirlar.length>0);

                return(
                  <div>
                    {/* Satış parametresi */}
                    <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",
                      background:"rgba(255,255,255,0.02)",border:`1px solid ${C.border}`,
                      borderRadius:12,padding:"10px 16px",marginBottom:16}}>
                      <span style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:1,textTransform:"uppercase"}}>
                        Satış Parametresi
                      </span>
                      <div style={{display:"flex",alignItems:"center",gap:7}}>
                        <span style={{fontSize:11,color:C.sub}}>Hedef Satış (KDV dahil):</span>
                        <NumInp value={malParams.targetSaleKdvDahil??aktifUrunObj?.satisKdvDahil??0}
                          step={1} suffix="₺" width={90}
                          onChange={v=>setMalParams(p=>({...p,targetSaleKdvDahil:v||0}))}/>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:7}}>
                        <span style={{fontSize:11,color:C.sub}}>Satış KDV %:</span>
                        <NumInp value={malParams.saleKdv??aktifUrunObj?.satisKdv??10}
                          step={1} suffix="%" width={55}
                          onChange={v=>setMalParams(p=>({...p,saleKdv:v||0}))}/>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:7}}>
                        <span style={{fontSize:11,color:C.sub}}>Gelir Vergisi %:</span>
                        <NumInp value={malParams.gelirVergisi??30} step={1} suffix="%" width={55}
                          onChange={v=>setMalParams(p=>({...p,gelirVergisi:v||0}))}/>
                      </div>
                      <button onClick={()=>setModal({type:"urunDuzenle",data:aktifUrunObj})}
                        style={{marginLeft:"auto",background:`${C.cyan}10`,border:`1px solid ${C.cyan}25`,
                        borderRadius:8,padding:"5px 12px",fontSize:11,color:C.cyan,cursor:"pointer"}}>
                        ✏️ BOM Düzenle
                      </button>
                    </div>

                    {/* Grup kartları */}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(480px,1fr))",gap:12,marginBottom:14}}>
                      {gruplar.map(g=>{
                        const gToplam = g.satirlar.reduce((s,b)=>s+b.kdvDahil,0);
                        const gMatrah = g.satirlar.reduce((s,b)=>s+b.matrah,0);
                        const gKdv    = g.satirlar.reduce((s,b)=>s+b.kdvTutar,0);
                        return(
                          <div key={g.id} style={{background:"rgba(255,255,255,.025)",
                            border:`1px solid ${g.renk}25`,borderRadius:14,overflow:"hidden"}}>
                            {/* Kart başlık */}
                            <div style={{background:`${g.renk}0E`,padding:"10px 16px",
                              display:"flex",justifyContent:"space-between",alignItems:"center",
                              borderBottom:`1px solid ${g.renk}20`}}>
                              <div style={{display:"flex",alignItems:"center",gap:8}}>
                                <span style={{fontSize:16}}>{g.ikon}</span>
                                <span style={{fontSize:13,fontWeight:700,color:g.renk,fontFamily:F}}>{g.label}</span>
                                <span style={{fontSize:10,color:C.muted}}>{g.satirlar.length} kalem</span>
                              </div>
                              <div style={{textAlign:"right"}}>
                                <div style={{fontSize:15,fontWeight:800,color:g.renk,fontFamily:F}}>{fmt(gToplam)}₺</div>
                                <div style={{fontSize:9,color:C.muted}}>KDV dahil · Matrah: {fmt(gMatrah)}₺</div>
                              </div>
                            </div>
                            {/* Satırlar */}
                            {g.satirlar.map((b,i)=>(
                              <div key={i} style={{padding:"9px 16px",
                                display:"flex",justifyContent:"space-between",alignItems:"center",
                                borderBottom:i<g.satirlar.length-1?`1px solid ${C.border}`:"none"}}>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontSize:12,color:C.text,fontWeight:500,
                                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                    {b.kalem?.ad||"?"}
                                  </div>
                                  <div style={{fontSize:10,color:C.muted}}>
                                    {b.miktar} {b.birim}
                                    {b.kalem?.kod&&<span style={{marginLeft:6,opacity:.6}}>{b.kalem.kod}</span>}
                                    {b.kalem?.tip==="ic"&&b.kalem?.sureDkAdet>0&&
                                      <span style={{marginLeft:6}}>· {b.kalem.sureDkAdet} dk</span>}
                                  </div>
                                </div>
                                <div style={{textAlign:"right",flexShrink:0,marginLeft:10}}>
                                  <div style={{fontSize:13,fontWeight:700,color:g.renk}}>{fmt(b.kdvDahil)}₺</div>
                                  <div style={{fontSize:9,color:C.muted}}>
                                    KDV %{b.kalem?.kdv||0} · Matrah: {fmt(b.matrah)}₺
                                  </div>
                                </div>
                              </div>
                            ))}
                            {/* Kart alt toplam */}
                            <div style={{padding:"7px 16px",background:`${g.renk}06`,
                              display:"flex",justifyContent:"flex-end",gap:16,
                              borderTop:`1px solid ${g.renk}15`}}>
                              {[["Matrah",gMatrah],["KDV",gKdv],["KDV Dahil",gToplam]].map(([l,v])=>(
                                <div key={l} style={{textAlign:"right"}}>
                                  <div style={{fontSize:9,color:C.muted}}>{l}</div>
                                  <div style={{fontSize:12,fontWeight:700,color:g.renk}}>{fmt(v)}₺</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Genel toplam */}
                    <div style={{background:"rgba(255,255,255,0.03)",border:`1px solid ${C.borderHi}`,
                      borderRadius:14,padding:"14px 20px",
                      display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
                      <div>
                        <div style={{fontSize:10,color:C.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:1}}>
                          GENEL TOPLAM
                        </div>
                        <div style={{fontSize:11,color:C.sub}}>{bomZengin.length} kalem</div>
                      </div>
                      <div style={{display:"flex",gap:20}}>
                        {[["Matrah",totMatrah,C.coral],["KDV",totKdv,C.gold],["KDV Dahil",totKdvDahil,C.cyan]].map(([l,v,c])=>(
                          <div key={l} style={{textAlign:"right"}}>
                            <div style={{fontSize:10,color:C.muted}}>{l}</div>
                            <div style={{fontSize:16,fontWeight:800,color:c,fontFamily:F}}>{fmt(v)}₺</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {malTab==="analiz"&&(
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                  <div style={{background:"rgba(255,255,255,0.03)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:`1px solid ${C.border}`,borderRadius:16,padding:"20px"}}>
                    <div style={{fontSize:14,fontWeight:700,color:C.text,fontFamily:F,marginBottom:14}}>Satış & Vergi Hesabı</div>
                    {[
                      {l:"Satış Fiyatı (KDV dahil)",v:`${fmt(hedefSatisKdvDahil)} ₺`,c:C.cyan,b:true},
                      {l:`KDV (%${hedefSatisKdv})`,v:`${fmt(hedefSatisKdvDahil-saleNet)} ₺`,c:C.muted},
                      {l:"Net Satış Fiyatı",v:`${fmt(saleNet)} ₺`,c:C.text},
                      {l:"Toplam Maliyet (—)",v:`${fmt(totMatrah)} ₺`,c:C.coral},
                      {l:"= Brüt Kar",v:`${fmt(brutKar)} ₺`,c:brutKar>0?C.mint:C.coral,b:true},
                      {l:"Brüt Marj",v:`%${fmt(brutPct,1)}`,c:brutPct>30?C.mint:C.gold},
                      {l:`Gelir Vergisi (%${malParams.gelirVergisi??30}) (—)`,v:`${fmt(vergi)} ₺`,c:C.coral},
                      {l:"= Net Kar",v:`${fmt(netKar)} ₺`,c:netKar>0?C.mint:C.coral,b:true,lg:true},
                      {l:"Net Marj",v:`%${fmt(netPct,1)}`,c:netPct>15?C.mint:C.gold,b:true,lg:true},
                    ].map((r,i)=>(
                      <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                        padding:"7px 0",borderBottom:`1px solid ${C.border}`}}>
                        <span style={{fontSize:r.lg?13:12,fontWeight:r.b?700:400,color:r.b?C.text:C.sub,fontFamily:r.b?F:FB}}>{r.l}</span>
                        <span style={{fontSize:r.lg?16:13,fontWeight:r.b?800:600,color:r.c,fontFamily:F,
                          textShadow:r.b?`0 0 10px ${r.c}40`:"none"}}>{r.v}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{background:"rgba(255,255,255,0.03)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:`1px solid ${C.border}`,borderRadius:16,padding:"20px"}}>
                    <div style={{fontSize:14,fontWeight:700,color:C.text,fontFamily:F,marginBottom:14}}>Maliyet Dağılımı</div>
                    {[
                      {id:"yarimamul",label:"Yarı Mamüller",ikon:"⚙️",renk:C.cyan},
                      {id:"hammadde", label:"Ham Maddeler", ikon:"🧱",renk:C.sky},
                      {id:"fason",    label:"Fason",        ikon:"🏭",renk:C.lav},
                      {id:"ic",       label:"İç İşçilik",   ikon:"👤",renk:C.gold},
                    ].map(g=>{
                      const satirlar = bomZengin.filter(b=>
                        g.id==="yarimamul"?b.tip==="yarimamul":
                        g.id==="hammadde"?b.tip==="hammadde":
                        g.id==="fason"?(b.tip==="hizmet"&&b.kalem?.tip==="fason"):
                        (b.tip==="hizmet"&&b.kalem?.tip==="ic")
                      );
                      if(!satirlar.length) return null;
                      const m=satirlar.reduce((s,b)=>s+b.matrah,0);
                      const pct=totMatrah>0?(m/totMatrah)*100:0;
                      return(
                        <div key={g.id} style={{marginBottom:10}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                            <span style={{fontSize:12,color:C.sub}}>{g.ikon} {g.label}</span>
                            <div style={{display:"flex",gap:8}}>
                              <span style={{fontSize:12,fontWeight:700,color:g.renk}}>{fmt(m)} ₺</span>
                              <span style={{fontSize:10,color:C.muted}}>%{fmt(pct,1)}</span>
                            </div>
                          </div>
                          <div style={{background:"rgba(255,255,255,.05)",borderRadius:4,height:5,overflow:"hidden"}}>
                            <div style={{width:`${Math.min(pct,100)}%`,height:"100%",background:g.renk,borderRadius:4,
                              animation:"bar-in 1.1s ease both",boxShadow:`0 0 6px ${g.renk}50`}}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {malTab==="kdv"&&(
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {[0,1,8,10,20].map(rate=>{
                    const rr=bomZengin.filter(b=>( b.kalem?.kdv||0 )===rate);
                    if(!rr.length) return null;
                    const m=rr.reduce((s,b)=>s+b.matrah,0);
                    const k=rr.reduce((s,b)=>s+b.kdvTutar,0);
                    const rc=rate===0?C.muted:rate<=8?C.gold:rate===10?C.mint:C.cyan;
                    return(
                      <div key={rate} style={{background:"rgba(255,255,255,0.03)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
                        <div style={{height:2,background:`linear-gradient(90deg,${rc},${rc}00)`}}/>
                        <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.border}`,
                          display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div style={{display:"flex",alignItems:"center",gap:10}}>
                            <Badge label={`%${rate} KDV`} color={rc}/>
                            <span style={{fontSize:11,color:C.muted}}>{rr.length} kalem</span>
                          </div>
                          <div style={{display:"flex",gap:16}}>
                            <div style={{textAlign:"right"}}><div style={{fontSize:9,color:C.muted}}>Matrah</div>
                              <div style={{fontSize:13,fontWeight:800,color:C.text,fontFamily:F}}>{fmt(m)} ₺</div></div>
                            <div style={{textAlign:"right"}}><div style={{fontSize:9,color:C.muted}}>KDV</div>
                              <div style={{fontSize:13,fontWeight:800,color:rc,fontFamily:F}}>+{fmt(k)} ₺</div></div>
                          </div>
                        </div>
                        <div style={{padding:"10px 18px",display:"flex",flexWrap:"wrap",gap:6}}>
                          {rr.map((b,i)=>(
                            <div key={i} style={{background:"rgba(255,255,255,.03)",border:`1px solid ${C.border}`,
                              borderRadius:8,padding:"4px 10px",display:"flex",gap:7,alignItems:"center"}}>
                              <span style={{fontSize:11,color:C.text}}>{b.kalem?.ad||"?"}</span>
                              <span style={{fontSize:11,fontWeight:700,color:b.renk||C.muted}}>{fmt(b.matrah)} ₺</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ─ REÇETE ─ */}
              {malTab==="recete"&&(
                <RecetePanel
                  urunId={u?.id}
                  recete={recete}
                  toplamDk={toplamDk}
                  istasyonlar={istasyonlar}
                  calisanlar={calisanlar}
                  stok={stok}
                  setReceteler={setReceteler}
                />
              )}

            </div>
            );
          })()}

          {/* ─ İSTASYONLAR ─ */}
          {tab==="istasyonlar"&&(
            <div style={{animation:"fade-up .35s ease"}}>
              <PageHeader title="İstasyonlar" sub={`${istasyonlar.length} istasyon`}
                action={<Btn variant="primary" onClick={()=>setModal({type:"yeniIstasyon",data:{}})}>+ İstasyon Ekle</Btn>}/>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10}}>
                {istasyonlar.map((is,i)=>{
                  const col=is.tip==="fason"?C.lav:is.durum==="aktif"?C.mint:C.muted;
                  return(
                    <div key={is.id} className="card" style={{background:"rgba(255,255,255,0.03)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:`1px solid ${col===C.mint?C.border:col+"28"}`,
                      borderRadius:16,overflow:"hidden",transition:"all .22s",animation:`fade-up .3s ${i*.05}s ease both`}}>
                      <div style={{height:2,background:`linear-gradient(90deg,${col},${col}00)`}}/>
                      <div style={{padding:"14px 16px"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                          <div>
                            <div style={{fontSize:15,fontWeight:700,color:C.text,fontFamily:F,marginBottom:2}}>{is.ad}</div>
                            <div style={{fontSize:11,color:C.muted}}>{is.calisan}</div>
                          </div>
                          <Badge label={is.tip==="fason"?"Fason":is.durum==="aktif"?"Aktif":"Boşta"}
                            color={col} small/>
                        </div>
                        {is.kapasite&&<div style={{fontSize:11,color:C.sub,marginBottom:8}}>⏱ {is.kapasite}</div>}
                        {is.notlar&&<div style={{fontSize:10,color:C.muted,marginBottom:8}}>📝 {is.notlar}</div>}
                        <button onClick={()=>setModal({type:"istasyonDuzenle",data:is})}
                          style={{width:"100%",background:"rgba(255,255,255,.04)",border:`1px solid ${C.border}`,
                            borderRadius:8,padding:"6px",fontSize:11,color:C.sub,cursor:"pointer"}}>Düzenle</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─ ÇALIŞANLAR ─ */}
          {tab==="calisanlar"&&(
            <div style={{animation:"fade-up .35s ease"}}>
              <PageHeader title="Çalışanlar" sub={`${calisanlar.length} çalışan`}
                action={<Btn variant="primary" onClick={()=>setModal({type:"yeniCalisan",data:{}})}>+ Çalışan Ekle</Btn>}/>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:10}}>
                {calisanlar.map((c,i)=>(
                  <div key={c.id} className="card" style={{background:"rgba(255,255,255,0.03)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:`1px solid ${C.border}`,
                    borderRadius:16,overflow:"hidden",transition:"all .22s",animation:`fade-up .3s ${i*.06}s ease both`}}>
                    <div style={{height:2,background:`linear-gradient(90deg,${C.cyan},${C.cyan}00)`}}/>
                    <div style={{padding:"16px 16px 14px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
                        <div style={{width:44,height:44,borderRadius:"50%",
                          background:`linear-gradient(135deg,${C.cyan}20,${C.lav}20)`,
                          border:`2px solid ${C.cyan}30`,display:"flex",alignItems:"center",
                          justifyContent:"center",fontSize:15,fontWeight:800,color:C.cyan,fontFamily:F}}>
                          {c.ad.split(" ").map(w=>w[0]).join("").slice(0,2)}
                        </div>
                        <div style={{flex:1}}>
                          <div style={{fontSize:15,fontWeight:700,color:C.text,fontFamily:F}}>{c.ad}</div>
                          <div style={{fontSize:12,color:C.muted}}>{c.rol}</div>
                        </div>
                        <Badge label={c.durum==="aktif"?"Aktif":"Pasif"} color={c.durum==="aktif"?C.mint:C.muted} small/>
                      </div>
                      {c.istasyon&&<div style={{fontSize:11,color:C.sub,marginBottom:4}}>⚙️ {c.istasyon}</div>}
                      {c.tel&&<div style={{fontSize:11,color:C.sub,marginBottom:10}}>📱 {c.tel}</div>}
                      <button onClick={()=>setModal({type:"calisanDuzenle",data:c})}
                        style={{width:"100%",background:"rgba(255,255,255,.04)",border:`1px solid ${C.border}`,
                          borderRadius:8,padding:"7px",fontSize:11,color:C.sub,cursor:"pointer"}}>Düzenle</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─ FASON ─ */}
          {tab==="fason"&&(
            <div style={{animation:"fade-up .35s ease"}}>
              <PageHeader title="Fason Firmalar" sub={`${fasonFirmalar.length} firma`}
                action={<Btn variant="primary" onClick={()=>setModal({type:"yeniFason",data:{}})}>+ Firma Ekle</Btn>}/>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:10}}>
                {fasonFirmalar.map((f,i)=>(
                  <div key={f.id} className="card" style={{background:"rgba(255,255,255,0.03)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:`1px solid ${C.lav}22`,
                    borderRadius:16,overflow:"hidden",transition:"all .22s",animation:`fade-up .3s ${i*.07}s ease both`}}>
                    <div style={{height:2,background:`linear-gradient(90deg,${C.lav},${C.lav}00)`}}/>
                    <div style={{padding:"16px 16px 14px"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                        <div>
                          <div style={{fontSize:15,fontWeight:700,color:C.text,fontFamily:F,marginBottom:2}}>{f.ad}</div>
                          <div style={{fontSize:12,color:C.lav}}>{f.tip}</div>
                        </div>
                        <Badge label="Fason" color={C.lav} small/>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:10}}>
                        {[["Süre",`${f.sureGun} gün`],["Birim Fiyat",`${f.birimFiyat} ₺`],["KDV",`%${f.kdv}`],["Toplam",`${fmt(f.birimFiyat*(1+f.kdv/100))} ₺`]].map(([l,v],j)=>(
                          <div key={j} style={{background:"rgba(255,255,255,0.02)",border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 10px"}}>
                            <div style={{fontSize:9,color:C.muted,marginBottom:1}}>{l}</div>
                            <div style={{fontSize:12,fontWeight:600,color:C.text}}>{v}</div>
                          </div>
                        ))}
                      </div>
                      {f.notlar&&<div style={{fontSize:11,color:C.muted,marginBottom:10}}>📝 {f.notlar}</div>}
                      <button onClick={()=>setModal({type:"fasonDuzenle",data:f})}
                        style={{width:"100%",background:`${C.lav}10`,border:`1px solid ${C.lav}22`,
                          borderRadius:8,padding:"7px",fontSize:11,fontWeight:600,color:C.lav,cursor:"pointer"}}>Düzenle</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─ GENEL AYARLAR ─ */}
          {tab==="genel"&&(
            <div style={{animation:"fade-up .35s ease",maxWidth:560}}>
              <PageHeader title="Genel Ayarlar"/>
              <div style={{background:"rgba(255,255,255,0.03)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:`1px solid ${C.border}`,borderRadius:16,padding:"22px"}}>
                <div style={{fontSize:13,fontWeight:700,color:C.text,fontFamily:F,marginBottom:16}}>Firma Bilgileri</div>
                <Field label="Firma / Atölye Adı">
                  <TextInp value={genelAyar.firmaAd} onChange={v=>setGenelAyar(p=>({...p,firmaAd:v}))}/>
                </Field>
                <Field label="Vergi Numarası">
                  <TextInp value={genelAyar.vergNo} onChange={v=>setGenelAyar(p=>({...p,vergNo:v}))} placeholder="123 456 789 0"/>
                </Field>
                <Field label="Telefon">
                  <TextInp value={genelAyar.tel} onChange={v=>setGenelAyar(p=>({...p,tel:v}))} placeholder="0212 xxx xx xx"/>
                </Field>
                <Field label="Adres">
                  <textarea value={genelAyar.adres} onChange={e=>setGenelAyar(p=>({...p,adres:e.target.value}))}
                    placeholder="Atölye adresi..." rows={3}
                    style={{width:"100%",background:"rgba(255,255,255,.04)",border:`1px solid ${C.border}`,
                      borderRadius:9,padding:"9px 12px",fontSize:13,color:C.text,resize:"vertical",
                      transition:"border-color .2s",fontFamily:FB}}
                    onFocus={e=>e.target.style.borderColor=`${C.cyan}50`}
                    onBlur={e=>e.target.style.borderColor=C.border}/>
                </Field>
                <Field label="Notlar">
                  <textarea value={genelAyar.notlar} onChange={e=>setGenelAyar(p=>({...p,notlar:e.target.value}))}
                    placeholder="Ek notlar..." rows={2}
                    style={{width:"100%",background:"rgba(255,255,255,.04)",border:`1px solid ${C.border}`,
                      borderRadius:9,padding:"9px 12px",fontSize:13,color:C.text,resize:"vertical",fontFamily:FB}}/>
                </Field>
                <Btn variant="primary" onClick={()=>alert("Kaydedildi!")}>💾 Kaydet</Btn>
              </div>
            </div>
          )}

        </main>
      </div>

      {/* ══ MODALS ══ */}
      {tedarikSiparisModal&&<TedarikSiparisModal
            m={tedarikSiparisModal}
            hamMaddeler={hamMaddeler}
            hizmetler={hizmetler}
            onClose={()=>setTedarikSiparisModal(null)}
            onKaydet={(siparis)=>{
              // 1. Tedarik siparişini kaydet
              setTedarikSiparisleri(p=>[...p, siparis]);
              // 2. UE'lerdeki eksik malzeme durumunu güncelle
              setUretimEmirleri(p=>p.map(e=>{
                const ilgili=(e.eksikMalzemeler||[]).find(m=>m.id===tedarikSiparisModal.id);
                if(!ilgili && e.durum==="tamamlandi") return e;
                const mevcutlar=e.eksikMalzemeler||[];
                const var2=mevcutlar.find(m=>m.id===tedarikSiparisModal.id);
                const guncellenmis={id:tedarikSiparisModal.id,tedarikDurum:"siparis",
                  siparisVerildi:siparis.siparisVerildiAt,
                  beklenenTarih:siparis.beklenenTeslimAt,not:siparis.not,
                  tedarikSiparisId:siparis.id};
                const eksikMalzemeler=var2
                  ?mevcutlar.map(m=>m.id===tedarikSiparisModal.id?{...m,...guncellenmis}:m)
                  :[...mevcutlar,guncellenmis];
                return {...e,eksikMalzemeler};
              }));
            }}
          />}
          {tedarikGirisModal&&<TedarikGirisModal
            m={tedarikGirisModal}
            hamMaddeler={hamMaddeler}
            hizmetler={hizmetler}
            tedarikSiparisleri={tedarikSiparisleri}
            onClose={()=>setTedarikGirisModal(null)}
            onKaydet={({gelenMiktar, kalanEksik, beklenenTarih, yonlendirme, fasonFirmaId, fasonFirmaAd, nakliyeKaydi, faturaNo, vadeGun, ilgiliSiparisId})=>{
              const malId=tedarikGirisModal.id;
              // 1. Stoka ekle (eğer depoya gidiyorsa)
              if(yonlendirme==="depo"){
                setHamMaddeler(p=>p.map(hm=>{
                  if(hm.id!==malId) return hm;
                  const yeniMiktar=(hm.miktar||0)+gelenMiktar;
                  stokHareketiRepo.ekle({
                    stokTipi:"hammadde",stokId:hm.id,hareketTipi:"satin_alma_girisi",
                    miktar:gelenMiktar,birim:hm.birim,
                    oncekiBakiye:hm.miktar||0,sonrakiBakiye:yeniMiktar,
                    kaynakModul:"tedarik",referenceType:"tedarik",
                    note:`Tedarik girişi: ${hm.ad}`,
                  });
                  return {...hm,miktar:yeniMiktar};
                }));
              }
              // 2. Nakliye kaydını kaydet
              if(nakliyeKaydi){
                setNakliyeKayitlari(p=>[...p, nakliyeKaydi]);
                // Ham maddenin nakliye bilgisini güncelle
                if(nakliyeKaydi.ucret>0&&gelenMiktar>0){
                  setHamMaddeler(p=>p.map(hm=>{
                    if(hm.id!==malId) return hm;
                    return {...hm, nakliye:{
                      ...hm.nakliye,
                      varsayilanNakliyeci: nakliyeKaydi.nakliyeci||hm.nakliye?.varsayilanNakliyeci||"",
                      nakliyeTel: nakliyeKaydi.nakliyeciTel||hm.nakliye?.nakliyeTel||"",
                      ortalamaUcret: nakliyeKaydi.ucret,
                      ortalamaYuk: gelenMiktar,
                    }};
                  }));
                }
              }
              // 3. Tedarik siparişi durumunu güncelle
              if(ilgiliSiparisId){
                const yeniSiparisDurum = kalanEksik<=0 ? "teslim_alindi" : "siparis_verildi";
                setTedarikSiparisleri(p=>p.map(ts=>{
                  if(ts.id!==ilgiliSiparisId) return ts;
                  return {...ts,
                    durum: yonlendirme==="fason" ? "fasona_gonderildi" : yeniSiparisDurum,
                    teslimAlindiAt: new Date().toISOString(),
                    faturaNo: faturaNo||ts.faturaNo,
                    vadeTarih: vadeGun>0 ? new Date(Date.now()+vadeGun*86400000).toISOString().slice(0,10) : ts.vadeTarih,
                    fasonYonlendirme: yonlendirme==="fason" ? {
                      ...ts.fasonYonlendirme,
                      gidecekMi: true,
                      fasonFirmaId: fasonFirmaId,
                      fasonFirmaAd: fasonFirmaAd,
                      gonderimAt: new Date().toISOString(),
                    } : ts.fasonYonlendirme,
                  };
                }));
              }
              // 4. UE eksik malzeme durumunu güncelle
              const yeniDurum=kalanEksik<=0?"geldi":"kismi";
              setUretimEmirleri(p=>p.map(e=>{
                const mevcutlar=e.eksikMalzemeler||[];
                const var2=mevcutlar.find(m=>m.id===malId);
                if(!var2) return e;
                const eksikMalzemeler=mevcutlar.map(m=>m.id===malId?{...m,
                  tedarikDurum:yeniDurum,
                  geldiAt:yeniDurum==="geldi"?new Date().toISOString():m.geldiAt,
                  beklenenTarih:beklenenTarih||m.beklenenTarih,
                }:m);
                return {...e,eksikMalzemeler};
              }));
            }}
          />}
          {modal&&<ModalDispatch modal={modal} setModal={setModal}
        siparisler={siparisler} setSiparisler={setSiparisler}
        stok={stok} setStok={setStok}
        hamMaddeler={hamMaddeler} setHamMaddeler={setHamMaddeler}
        yarimamulList={yarimamulList} setYM={setYM}
        hizmetler={hizmetler} setHizmetler={setHizmetler}
        urunBomList={urunBomList} setUrunBomList={setUrunBomList}
        istasyonlar={istasyonlar} setIstasyonlar={setIstasyonlar}
        calisanlar={calisanlar} setCalisanlar={setCalisanlar}
        fasonFirmalar={fasonFirmalar} setFasonFirmalar={setFasonFirmalar}
        urunler={urunler} setUrunler={setUrunler}
        uretimEmirleri={uretimEmirleri} setUretimEmirleri={setUretimEmirleri}
        setAktifUE={setAktifUE}
        musteriler={musteriler} setMusteriler={setMusteriler}
        sevkiyatlar={sevkiyatlar} setSevkiyatlar={setSevkiyatlar}
        fasonIsler={fasonIsler} setFasonIsler={setFasonIsler}/>}
    </>
  );
}

// ══ REÇETE PANEL ═════════════════════════════════════════════════════════════
function RecetePanel({urunId,recete,toplamDk,istasyonlar,calisanlar,stok,setReceteler}){
  const [editId,setEditId] = useState(null); // which asama is being edited inline
  const [addMalModal,setAddMalModal] = useState(null); // {asamaId}
  const [addAsamaModal,setAddAsamaModal] = useState(false);

  const updateAsama=(id,field,value)=>{
    setReceteler(p=>({...p,[urunId]:p[urunId]?.map(a=>a.id===id?{...a,[field]:value}:a)||[]}));
  };
  const deleteAsama=(id)=>{
    setReceteler(p=>({...p,[urunId]:(p[urunId]||[]).filter(a=>a.id!==id).map((a,i)=>({...a,sira:i+1}))}));
  };
  const moveAsama=(id,dir)=>{
    setReceteler(p=>{
      const arr=[...(p[urunId]||[])];
      const idx=arr.findIndex(a=>a.id===id);
      const to=idx+dir;
      if(to<0||to>=arr.length)return p;
      [arr[idx],arr[to]]=[arr[to],arr[idx]];
      return {...p,[urunId]:arr.map((a,i)=>({...a,sira:i+1}))};
    });
  };
  const addAsama=(form)=>{
    setReceteler(p=>{
      const cur=p[urunId]||[];
      return {...p,[urunId]:[...cur,{id:uid(),sira:cur.length+1,...form,malzemeler:[]}]};
    });
  };
  const deleteMal=(asamaId,malId)=>{
    setReceteler(p=>({...p,[urunId]:(p[urunId]||[]).map(a=>a.id===asamaId?{...a,malzemeler:a.malzemeler.filter(m=>m.id!==malId)}:a)}));
  };
  const addMal=(asamaId,mal)=>{
    setReceteler(p=>({...p,[urunId]:(p[urunId]||[]).map(a=>a.id===asamaId?{...a,malzemeler:[...a.malzemeler,{id:uid(),...mal}]}:a)}));
  };

  const fasonCount=recete.filter(r=>r.fason).length;
  const paralelCount=recete.filter(r=>r.paralel).length;

  return(
    <div>
      {/* Özet şerit */}
      <div style={{display:"flex",gap:10,marginBottom:18,flexWrap:"wrap"}}>
        {[
          {l:"Toplam Aşama",  v:recete.length,         u:"adım",  col:C.cyan},
          {l:"İç Üretim",    v:recete.length-fasonCount,u:"aşama", col:C.mint},
          {l:"Fason",         v:fasonCount,             u:"aşama", col:C.lav},
          {l:"İç Üretim Süresi",v:toplamDk,             u:"dk/adet",col:C.gold},
          {l:"Paralel Aşama", v:paralelCount,           u:"adet",  col:C.sky},
        ].map((k,i)=>(
          <div key={i} style={{background:"rgba(255,255,255,0.03)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:`1px solid ${k.col}22`,borderRadius:12,
            padding:"10px 16px",display:"flex",alignItems:"center",gap:10}}>
            <div>
              <div style={{fontSize:10,color:C.muted}}>{k.l}</div>
              <div style={{fontSize:18,fontWeight:800,color:k.col,fontFamily:F,lineHeight:1.1}}>
                {k.v}<span style={{fontSize:11,fontWeight:400,color:C.muted,marginLeft:3}}>{k.u}</span>
              </div>
            </div>
          </div>
        ))}
        <button onClick={()=>setAddAsamaModal(true)}
          style={{marginLeft:"auto",background:`linear-gradient(135deg,${C.mint},${C.cyan})`,
            border:"none",borderRadius:12,padding:"10px 18px",fontWeight:700,fontSize:13,color:"#fff",
            cursor:"pointer",fontFamily:FB,boxShadow:`0 4px 14px ${C.mint}28`,transition:"all .2s",alignSelf:"center"}}>
          + Aşama Ekle
        </button>
      </div>

      {/* Aşama listesi */}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {recete.map((asama,idx)=>{
          const isEditing=editId===asama.id;
          const acol=asama.fason?C.lav:C.cyan;
          return(
            <div key={asama.id} style={{background:"rgba(255,255,255,0.03)",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",border:`1px solid ${isEditing?acol+"50":C.border}`,
              borderRadius:16,overflow:"hidden",transition:"border-color .2s",
              boxShadow:isEditing?`0 0 0 1px ${acol}20,0 8px 24px rgba(0,0,0,.3)`:"0 2px 8px rgba(0,0,0,.2)"}}>
              {/* Accent top bar */}
              <div style={{height:2,background:`linear-gradient(90deg,${acol},${acol}00)`}}/>

              <div style={{padding:"12px 16px"}}>
                {/* Header row */}
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  {/* Sıra + taşı */}
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:1,flexShrink:0}}>
                    <button onClick={()=>moveAsama(asama.id,-1)} disabled={idx===0}
                      style={{background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:5,
                        width:20,height:18,cursor:idx===0?"not-allowed":"pointer",color:idx===0?C.muted:C.sub,
                        fontSize:10,lineHeight:1,transition:"all .15s"}}>▲</button>
                    <div style={{width:28,height:28,borderRadius:8,background:`${acol}14`,border:`1px solid ${acol}28`,
                      display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,
                      color:acol,fontFamily:F}}>{asama.sira}</div>
                    <button onClick={()=>moveAsama(asama.id,1)} disabled={idx===recete.length-1}
                      style={{background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:5,
                        width:20,height:18,cursor:idx===recete.length-1?"not-allowed":"pointer",
                        color:idx===recete.length-1?C.muted:C.sub,fontSize:10,lineHeight:1,transition:"all .15s"}}>▼</button>
                  </div>

                  {/* Aşama bilgileri */}
                  <div style={{flex:1}}>
                    {isEditing?(
                      <input value={asama.ad} onChange={e=>updateAsama(asama.id,"ad",e.target.value)}
                        className="inp" style={{fontSize:15,fontWeight:700,color:C.text,fontFamily:F,
                          background:"rgba(255,255,255,.05)",border:`1px solid ${acol}40`,borderRadius:8,
                          padding:"6px 10px",width:"100%",marginBottom:6}}/>
                    ):(
                      <div style={{fontSize:15,fontWeight:700,color:C.text,fontFamily:F,marginBottom:4}}>{asama.ad}</div>
                    )}
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                      {asama.fason&&<Badge label="Fason" color={C.lav} small/>}
                      {asama.paralel&&<Badge label="⇉ Paralel" color={C.sky} small/>}
                      {!isEditing&&<>
                        <span style={{fontSize:11,color:C.muted}}>⚙️ {asama.istasyon||"—"}</span>
                        <span style={{fontSize:11,color:C.muted}}>👤 {asama.calisan||"—"}</span>
                        {asama.sureDk>0&&<span style={{fontSize:11,color:C.gold}}>⏱ {asama.sureDk} dk/adet</span>}
                      </>}
                    </div>
                  </div>

                  {/* Aksiyon butonları */}
                  <div style={{display:"flex",gap:6,flexShrink:0}}>
                    <button onClick={()=>setEditId(isEditing?null:asama.id)}
                      style={{background:isEditing?`${acol}18`:"rgba(255,255,255,.05)",
                        border:`1px solid ${isEditing?acol+"40":C.border}`,borderRadius:8,
                        padding:"6px 12px",fontSize:11,fontWeight:600,
                        color:isEditing?acol:C.sub,cursor:"pointer",transition:"all .15s"}}>
                      {isEditing?"✓ Tamam":"✏ Düzenle"}
                    </button>
                    <button onClick={()=>deleteAsama(asama.id)}
                      style={{background:"rgba(255,107,107,.07)",border:`1px solid ${C.coral}22`,borderRadius:8,
                        padding:"6px 10px",fontSize:11,color:C.coral,cursor:"pointer",transition:"all .15s"}}>🗑</button>
                  </div>
                </div>

                {/* Edit mode detaylar */}
                {isEditing&&(
                  <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`,
                    display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div>
                      <div style={{fontSize:10,fontWeight:600,color:C.muted,marginBottom:4}}>İSTASYON</div>
                      <select value={asama.istasyon||""} onChange={e=>updateAsama(asama.id,"istasyon",e.target.value)}
                        style={{width:"100%",background:"rgba(255,255,255,0.04)",border:`1px solid ${C.border}`,borderRadius:8,
                          padding:"8px 10px",fontSize:12,color:C.text,cursor:"pointer"}}>
                        <option value="">— Seç —</option>
                        {istasyonlar.map(is=><option key={is.id} value={is.ad}>{is.ad} {is.tip==="fason"?"(Fason)":""}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize:10,fontWeight:600,color:C.muted,marginBottom:4}}>SORUMLU / KAYNAK</div>
                      <select value={asama.calisan||""} onChange={e=>updateAsama(asama.id,"calisan",e.target.value)}
                        style={{width:"100%",background:"rgba(255,255,255,0.04)",border:`1px solid ${C.border}`,borderRadius:8,
                          padding:"8px 10px",fontSize:12,color:C.text,cursor:"pointer"}}>
                        <option value="">— Seç —</option>
                        <option value="—">— (Fason / Dış)</option>
                        {calisanlar.map(c=><option key={c.id} value={c.ad}>{c.ad}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize:10,fontWeight:600,color:C.muted,marginBottom:4}}>SÜRE (DK/ADET)</div>
                      <NumInp value={asama.sureDk} onChange={v=>updateAsama(asama.id,"sureDk",v||0)} width={100} suffix="dk"/>
                    </div>
                    <div style={{display:"flex",gap:16,alignItems:"center",paddingTop:20}}>
                      <label style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer"}}>
                        <div onClick={()=>updateAsama(asama.id,"fason",!asama.fason)}
                          style={{width:32,height:18,borderRadius:9,cursor:"pointer",
                            background:asama.fason?C.lav:"rgba(255,255,255,.1)",position:"relative",transition:"background .2s",flexShrink:0}}>
                          <div style={{position:"absolute",top:2,left:asama.fason?16:2,width:14,height:14,borderRadius:"50%",
                            background:"#fff",transition:"left .2s"}}/>
                        </div>
                        <span style={{fontSize:12,color:C.sub}}>Fason</span>
                      </label>
                      <label style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer"}}>
                        <div onClick={()=>updateAsama(asama.id,"paralel",!asama.paralel)}
                          style={{width:32,height:18,borderRadius:9,cursor:"pointer",
                            background:asama.paralel?C.sky:"rgba(255,255,255,.1)",position:"relative",transition:"background .2s",flexShrink:0}}>
                          <div style={{position:"absolute",top:2,left:asama.paralel?16:2,width:14,height:14,borderRadius:"50%",
                            background:"#fff",transition:"left .2s"}}/>
                        </div>
                        <span style={{fontSize:12,color:C.sub}}>Paralel</span>
                      </label>
                    </div>
                    <div style={{gridColumn:"1/-1"}}>
                      <div style={{fontSize:10,fontWeight:600,color:C.muted,marginBottom:4}}>NOTLAR</div>
                      <input value={asama.notlar||""} onChange={e=>updateAsama(asama.id,"notlar",e.target.value)}
                        className="inp" placeholder="Ek not..." style={{width:"100%",background:"rgba(255,255,255,.04)",
                          border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",fontSize:12,color:C.text}}/>
                    </div>
                  </div>
                )}

                {/* Malzeme listesi */}
                {asama.malzemeler.length>0&&(
                  <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid rgba(255,255,255,.05)`}}>
                    <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:.6,
                      textTransform:"uppercase",marginBottom:6}}>📦 Kullanılan Malzemeler</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                      {asama.malzemeler.map(m=>(
                        <div key={m.id} style={{background:"rgba(255,255,255,.04)",border:`1px solid ${C.border}`,
                          borderRadius:8,padding:"4px 10px",display:"flex",alignItems:"center",gap:7}}>
                          <span style={{fontSize:11,color:C.text}}>{m.ad}</span>
                          <span style={{fontSize:11,fontWeight:700,color:C.gold}}>{m.miktar} {m.birim}</span>
                          {isEditing&&<button onClick={()=>deleteMal(asama.id,m.id)}
                            style={{background:"none",border:"none",cursor:"pointer",color:C.coral,fontSize:13,lineHeight:1,padding:0}}>×</button>}
                        </div>
                      ))}
                      {isEditing&&<button onClick={()=>setAddMalModal({asamaId:asama.id})}
                        style={{background:`${C.gold}0E`,border:`1px solid ${C.gold}28`,borderRadius:8,
                          padding:"4px 10px",fontSize:11,color:C.gold,cursor:"pointer"}}>+ Malzeme Ekle</button>}
                    </div>
                  </div>
                )}
                {asama.malzemeler.length===0&&isEditing&&(
                  <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid rgba(255,255,255,.05)`}}>
                    <button onClick={()=>setAddMalModal({asamaId:asama.id})}
                      style={{background:`${C.gold}0E`,border:`1px solid ${C.gold}28`,borderRadius:8,
                        padding:"6px 14px",fontSize:11,color:C.gold,cursor:"pointer"}}>+ Malzeme Ekle</button>
                  </div>
                )}

                {/* Notlar (view mode) */}
                {!isEditing&&asama.notlar&&(
                  <div style={{marginTop:8,fontSize:11,color:C.muted}}>📝 {asama.notlar}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Yeni Aşama Modal */}
      {addAsamaModal&&(
        <AddAsamaModal
          istasyonlar={istasyonlar}
          calisanlar={calisanlar}
          onClose={()=>setAddAsamaModal(false)}
          onSave={(form)=>{addAsama(form);setAddAsamaModal(false);}}/>
      )}

      {/* Malzeme Ekle Modal */}
      {addMalModal&&(
        <AddMalzemeModal
          stok={stok}
          onClose={()=>setAddMalModal(null)}
          onSave={(mal)=>{addMal(addMalModal.asamaId,mal);setAddMalModal(null);}}/>
      )}
    </div>
  );
}

function AddAsamaModal({istasyonlar,calisanlar,onClose,onSave}){
  const [form,setForm]=useState({ad:"",istasyon:"",calisan:"",sureDk:0,fason:false,paralel:false,notlar:""});
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  return(
    <Modal title="Yeni Aşama Ekle" onClose={onClose} width={500}>
      <Field label="Aşama Adı"><TextInp value={form.ad} onChange={v=>set("ad",v)} placeholder="Döşeme"/></Field>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Field label="İstasyon">
          <select value={form.istasyon} onChange={e=>set("istasyon",e.target.value)}
            style={{width:"100%",background:"#161C2A",border:`1px solid ${C.border}`,borderRadius:9,
              padding:"9px 12px",fontSize:13,color:C.text,cursor:"pointer"}}>
            <option value="">— Seç —</option>
            {istasyonlar.map(is=><option key={is.id} value={is.ad}>{is.ad}</option>)}
          </select>
        </Field>
        <Field label="Sorumlu">
          <select value={form.calisan} onChange={e=>set("calisan",e.target.value)}
            style={{width:"100%",background:"#161C2A",border:`1px solid ${C.border}`,borderRadius:9,
              padding:"9px 12px",fontSize:13,color:C.text,cursor:"pointer"}}>
            <option value="">— Seç —</option>
            <option value="—">— (Fason)</option>
            {calisanlar.map(c=><option key={c.id} value={c.ad}>{c.ad}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Süre (dk/adet)">
        <NumInp value={form.sureDk} onChange={v=>set("sureDk",v||0)} suffix="dk" width={110}/>
      </Field>
      <div style={{display:"flex",gap:20,marginBottom:14}}>
        {[["fason","Fason Aşama",C.lav],["paralel","Paralel Çalışabilir",C.sky]].map(([k,l,c])=>(
          <label key={k} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
            <div onClick={()=>set(k,!form[k])} style={{width:34,height:19,borderRadius:10,cursor:"pointer",
              background:form[k]?c:"rgba(255,255,255,.1)",position:"relative",transition:"background .2s",flexShrink:0}}>
              <div style={{position:"absolute",top:2,left:form[k]?17:2,width:15,height:15,borderRadius:"50%",
                background:"#fff",transition:"left .2s"}}/>
            </div>
            <span style={{fontSize:13,color:C.sub}}>{l}</span>
          </label>
        ))}
      </div>
      <Field label="Notlar"><TextInp value={form.notlar} onChange={v=>set("notlar",v)} placeholder=""/></Field>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:6}}>
        <Btn onClick={onClose}>İptal</Btn>
        <Btn variant="primary" color={C.mint} onClick={()=>{if(!form.ad){alert("Aşama adı zorunlu!");return;}onSave(form);}}>Ekle</Btn>
      </div>
    </Modal>
  );
}

function AddMalzemeModal({stok,onClose,onSave}){
  const [mode,setMode]=useState("stok"); // stok | manuel
  const [secilen,setSecilen]=useState("");
  const [miktar,setMiktar]=useState(1);
  const [manuelAd,setManuelAd]=useState("");
  const [manuelBirim,setManuelBirim]=useState("adet");
  const stoktakiS=stok.find(s=>s.id===secilen);
  const save=()=>{
    if(mode==="stok"){
      if(!secilen){alert("Malzeme seçin!");return;}
      onSave({ad:stoktakiS.ad,miktar,birim:stoktakiS.birim});
    } else {
      if(!manuelAd){alert("Malzeme adı girin!");return;}
      onSave({ad:manuelAd,miktar,birim:manuelBirim});
    }
  };
  return(
    <Modal title="Malzeme Ekle" onClose={onClose} width={440}>
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[["stok","Stoktan Seç"],["manuel","Manuel Gir"]].map(([m,l])=>(
          <button key={m} onClick={()=>setMode(m)} style={{flex:1,padding:"8px",borderRadius:9,border:`1px solid ${mode===m?C.cyan+"50":C.border}`,
            background:mode===m?`${C.cyan}10`:"rgba(255,255,255,.03)",color:mode===m?C.cyan:C.muted,
            fontSize:12,fontWeight:mode===m?600:400,cursor:"pointer",transition:"all .15s"}}>{l}</button>
        ))}
      </div>
      {mode==="stok"?(
        <Field label="Malzeme">
          <select value={secilen} onChange={e=>setSecilen(e.target.value)}
            style={{width:"100%",background:"#161C2A",border:`1px solid ${C.border}`,borderRadius:9,
              padding:"9px 12px",fontSize:13,color:C.text,cursor:"pointer"}}>
            <option value="">— Stoktan seç —</option>
            {stok.map(s=><option key={s.id} value={s.id}>{s.ad} ({s.birim})</option>)}
          </select>
        </Field>
      ):(
        <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:10}}>
          <Field label="Malzeme Adı"><TextInp value={manuelAd} onChange={setManuelAd} placeholder="Özel malzeme"/></Field>
          <Field label="Birim"><TextInp value={manuelBirim} onChange={setManuelBirim} placeholder="adet"/></Field>
        </div>
      )}
      <Field label={`Miktar${stoktakiS?" ("+stoktakiS.birim+")":""}`}>
        <NumInp value={miktar} onChange={v=>setMiktar(v||0)} step={0.001} width={120}/>
      </Field>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:6}}>
        <Btn onClick={onClose}>İptal</Btn>
        <Btn variant="primary" color={C.gold} onClick={save}>Ekle</Btn>
      </div>
    </Modal>
  );
}

// ── MODAL: ÜRETİM EMRİ ──────────────────────────────────────────────────────
function UretimEmriModal({init,duzenleme,onClose,urunler,urunBomList,yarimamulList,hamMaddeler,calisanlar,hizmetler,setUretimEmirleri,setAktifUE}){
  const [ue,setUE]=useState({strateji:"gunluk",...init});
  const [silOnay,setSilOnay]=useState(false);
  const upUE=(k,v)=>setUE(p=>({...p,[k]:v}));

  // malzemeKontrol: engine'e bağlandı — tek kaynak
  const malzemeKontrol = useMemo(()=>{
    const urun = [...(urunler||[]),...(urunBomList||[])].find(x=>x.id===ue.urunId);
    if(!urun?.bom) return {liste:[],debugLog:[]};
    const liste = bomMalzemeListesi(urun, ue.adet||1, hamMaddeler||[], yarimamulList||[], urunler||[]);
    return {liste, debugLog:[]};
  },[ue.urunId, ue.adet, hamMaddeler, urunler, yarimamulList]); // urunBomList=urunler alias, tekrar yok
  const malzemeListesi = malzemeKontrol?.liste || [];
  const malzemeDebug  = malzemeKontrol?.debugLog || [];

  const eksikVar = malzemeListesi.some(m=>!m.yeterli);

  // BOM'dan aşamaları otomatik oluştur
  const bomdenAsamaOlustur = (urun, adet=1) => {
    if(!urun?.bom?.length) return [];
    const tumHizmetler = hizmetler||[];
    const asamalar = [];
    // Rekürsif: YM içindeki fason+iç işçilikleri topla
    const hizmetTopla = (bom, derinlik=0) => {
      if(derinlik>6) return;
      (bom||[]).forEach(b=>{
        if(b.tip==="hizmet"){
          const hz = tumHizmetler.find(x=>x.id===b.kalemId);
          if(hz) asamalar.push({
            id:uid(), ad:hz.ad, durum:"bekliyor",
            calisan: hz.calisan||"",
            sureDk: hz.sureDkAdet||0,
            fason: hz.tip==="fason",
            hizmetId: hz.id
          });
        } else if(b.tip==="yarimamul"){
          const ym = (yarimamulList||[]).find(x=>x.id===b.kalemId)
                  || (urunler||[]).find(x=>x.id===b.kalemId)
                  || (urunBomList||[]).find(x=>x.id===b.kalemId);
          hizmetTopla(ym?.bom||[], derinlik+1);
        }
      });
    };
    // Önce YM içlerini tara
    urun.bom.forEach(b=>{
      if(b.tip==="yarimamul"){
        const ym = (yarimamulList||[]).find(x=>x.id===b.kalemId)
                || (urunler||[]).find(x=>x.id===b.kalemId)
                || (urunBomList||[]).find(x=>x.id===b.kalemId);
        hizmetTopla(ym?.bom||[], 1);
      } else if(b.tip==="hizmet"){
        const hz = tumHizmetler.find(x=>x.id===b.kalemId);
        if(hz) asamalar.push({
          id:uid(), ad:hz.ad, durum:"bekliyor",
          calisan:hz.calisan||"",
          sureDk:hz.sureDkAdet||0,
          fason:hz.tip==="fason",
          hizmetId:hz.id
        });
      }
    });
    // Tekrar edenleri temizle (aynı ad)
    const tekSiz = [];
    const goruldu = new Set();
    asamalar.forEach(a=>{
      if(!goruldu.has(a.ad)){goruldu.add(a.ad);tekSiz.push(a);}
    });
    return tekSiz;
  };

  // Termin hesaplama
  // ekleIsGunu / isGunuFarki: engine'e bağlandı
  const ekleIsGunu = ekleIsGunuEngine;
  const isGunuFarki = isGunuFarkiEngine;

  // terminHesapla: engine'e bağlandı
  const terminHesapla = terminHesaplaEngine;

  const secilenUrun = [...(urunler||[]),...(urunBomList||[])].find(x=>x.id===ue.urunId);
  const tahmin = ue.asamalar?.length>0 ? terminHesapla(ue.asamalar, ue.adet||1) : null;
  const terminStr = tahmin?.termin ? tahmin.termin.toISOString().slice(0,10) : "";

  const handleUrunSec = (urunId) => {
    const u = [...(urunler||[]),...(urunBomList||[])].find(x=>x.id===urunId);
    if(!u){setUE(p=>({...p,urunId:"",urunAd:"",asamalar:[]}));return;}
    const asamalar = bomdenAsamaOlustur(u, ue.adet||1);
    const tahminYeni = asamalar.length>0 ? terminHesapla(asamalar, ue.adet||1) : null;
    setUE(p=>({...p,
      urunId, urunAd:u.ad,
      asamalar,
      termin: tahminYeni?.termin ? tahminYeni.termin.toISOString().slice(0,10) : p.termin
    }));
  };

  const handleAdetDegis = (adet) => {
    const tahminYeni = ue.asamalar?.length>0 ? terminHesapla(ue.asamalar, adet) : null;
    setUE(p=>({...p, adet,
      termin: tahminYeni?.termin ? tahminYeni.termin.toISOString().slice(0,10) : p.termin
    }));
  };

  const handleSave=()=>{
    if(!ue.urunAd?.trim()){alert("Ürün adı giriniz");return;}
    // Eksik malzemeleri UE'ye kaydet (tedarik takibi için)
    const ueKayit = {...ue, eksikMalzemeler: malzemeListesi.filter(m=>!m.yeterli)};
    if(duzenleme){
      setUretimEmirleri(p=>p.map(e=>e.id===ue.id?ueKayit:e));
    } else {
      setUretimEmirleri(p=>[...p,ueKayit]);
      setAktifUE&&setAktifUE(ue.id);
    }
    onClose();
  };

  const handleSil = () => {
    if(silOnay){setUretimEmirleri(p=>p.filter(e=>e.id!==ue.id));onClose();}
    else{setSilOnay(true);setTimeout(()=>setSilOnay(false),3000);}
  };

  const INP = {width:"100%",background:C.s3,border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 12px",fontSize:13,color:C.text};

  return(
    <Modal title={duzenleme?"Üretim Emri Düzenle":"Yeni Üretim Emri"} onClose={onClose} width={620} maxHeight="85vh">

      {/* Üst grid: kod + adet */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
        <Field label="Emir Kodu">
          <input value={ue.kod} onChange={e=>upUE("kod",e.target.value)} style={INP}/>
        </Field>
        <Field label="Üretim Adeti">
          <NumInp value={ue.adet} onChange={handleAdetDegis} min={1} style={{width:"100%"}}/>
        </Field>
      </div>

      {/* Ürün seçimi */}
      <Field label="Ürün" style={{marginBottom:12}}>
        <select value={ue.urunId} onChange={e=>handleUrunSec(e.target.value)}
          style={{...INP,cursor:"pointer"}}>
          <option value="">— Ürün seçin (aşamalar otomatik gelir)</option>
          {(urunler||[]).map(u=><option key={u.id} value={u.id}>{u.kod?u.kod+" — ":""}{u.ad}</option>)}
        </select>
      </Field>

      {/* Sipariş No */}
      <Field label="Sipariş No (opsiyonel)" style={{marginBottom:12}}>
        <input value={ue.sipNo} onChange={e=>upUE("sipNo",e.target.value)}
          placeholder="SP-001..." style={INP}/>
      </Field>

      {/* Termin — çift yönlü: tarih ↔ gün */}
      <div style={{background:"rgba(255,255,255,0.02)",border:`1px solid ${C.border}`,
        borderRadius:12,padding:"12px 14px",marginBottom:12}}>
        <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:1,
          textTransform:"uppercase",marginBottom:10}}>📅 Termin</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:8,alignItems:"center",marginBottom:10}}>
          {/* Tarih seç */}
          <div>
            <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Termin Tarihi</div>
            <input type="date" value={ue.termin||""} onChange={e=>{
              upUE("termin",e.target.value);
            }} style={INP}/>
          </div>
          <div style={{textAlign:"center",color:C.muted,fontSize:14,paddingTop:20}}>⇄</div>
          {/* Gün gir */}
          <div>
            <div style={{fontSize:10,color:C.muted,marginBottom:4}}>veya Gün Sayısı Gir</div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <NumInp value={ue.termin ? isGunuFarki(new Date(), ue.termin) : ""}
                onChange={v=>{
                  if(v>0){
                    const t = ekleIsGunu(new Date(), Math.round(v));
                    upUE("termin", t.toISOString().slice(0,10));
                  }
                }} step={1} min={1} style={{flex:1}}/>
              <span style={{fontSize:11,color:C.muted,whiteSpace:"nowrap"}}>iş günü</span>
            </div>
          </div>
        </div>

        {/* Durum + öneri */}
        {tahmin&&(
          <div style={{fontSize:11,borderTop:`1px solid ${C.border}`,paddingTop:8}}>
            <div style={{display:"flex",gap:14,flexWrap:"wrap",color:C.muted,marginBottom:4}}>
              <span>🏭 Atölye: <strong style={{color:C.text}}>{tahmin.atolyeGun} iş günü</strong></span>
              {tahmin.fasonGun>0&&<span>🏢 Fason: <strong style={{color:C.lav}}>+{tahmin.fasonGun} gün</strong></span>}
              <span>📆 Min. süre: <strong style={{color:C.gold}}>{tahmin.toplamGun} gün</strong></span>
              <span style={{color:C.cyan}}>En erken: <strong>{terminStr}</strong></span>
            </div>
            {!ue.termin&&(
              <button onClick={()=>upUE("termin",terminStr)}
                style={{background:`${C.cyan}15`,border:`1px solid ${C.cyan}30`,borderRadius:7,
                padding:"4px 12px",fontSize:11,color:C.cyan,cursor:"pointer"}}>
                → Otomatik termini uygula ({terminStr})
              </button>
            )}
            {ue.termin&&ue.termin<terminStr&&(()=>{
              const mevcutGun = isGunuFarki(new Date(), ue.termin);
              const gerekliSn = tahmin.toplamSn; // zaten adet ile çarpılmış
              const mevcutSn  = mevcutGun * 28800; // 8 saat/gün
              const acikSn    = Math.max(0, gerekliSn - mevcutSn);
              const gundeEkstraSn = mevcutGun>0 ? Math.ceil(acikSn/mevcutGun) : 0;
              const gundeEkstraSaat = (gundeEkstraSn/3600).toFixed(1);
              return (
                <div style={{color:C.coral}}>
                  <div style={{fontWeight:700,marginBottom:4}}>
                    ⚠ Termin kısa! {mevcutGun} iş günü var, min. {tahmin.toplamGun} gün gerekli.
                  </div>
                  {acikSn>0&&(
                    <div style={{background:`${C.coral}10`,borderRadius:8,padding:"8px 10px",
                      marginBottom:6,fontSize:11}}>
                      <div style={{marginBottom:3}}>
                        💪 <strong>Mesai Gereksinimi:</strong>
                      </div>
                      <div style={{display:"flex",gap:12,flexWrap:"wrap",color:C.muted}}>
                        <span>Toplam açık: <strong style={{color:C.coral}}>{Math.ceil(acikSn/3600)} saat</strong></span>
                        <span>Günde ekstra: <strong style={{color:C.gold}}>{gundeEkstraSaat} saat mesai</strong></span>
                        <span style={{color:C.text}}>→ Günde {(8+parseFloat(gundeEkstraSaat)).toFixed(1)} saat çalışılmalı</span>
                      </div>
                    </div>
                  )}
                  <button onClick={()=>upUE("termin",terminStr)}
                    style={{background:`${C.gold}15`,border:`1px solid ${C.gold}30`,
                    borderRadius:6,padding:"3px 10px",fontSize:10,color:C.gold,cursor:"pointer"}}>
                    Tahmini uygula ({terminStr})
                  </button>
                </div>
              );
            })()}
            {ue.termin&&ue.termin>=terminStr&&(
              <div style={{color:C.mint}}>✓ Termin uygun — <strong>{isGunuFarki(new Date(),ue.termin)}</strong> iş günü var, {isGunuFarki(new Date(),ue.termin)-tahmin.toplamGun} gün buffer.</div>
            )}
          </div>
        )}
        {!tahmin&&ue.termin&&(
          <div style={{fontSize:11,color:C.muted}}>
            Termin: <strong style={{color:C.cyan}}>{ue.termin}</strong> · <strong>{isGunuFarki(new Date(),ue.termin)}</strong> iş günü kaldı
          </div>
        )}
      </div>

      {/* ── ÜRETİM STRATEJİSİ ── */}
      <div style={{marginBottom:12}}>
        <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:1,
          textTransform:"uppercase",marginBottom:8}}>⚡ Üretim Stratejisi</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {[
            {id:"gunluk", ikon:"🔄", baslik:"Günlük Akış",
             aciklama:"Her gün tamamlanmış ürün çıkar. Örn: günde 120 adet döngüsü biter."},
            {id:"haftalik", ikon:"📦", baslik:"Haftalık Batch",
             aciklama:"Önce hepsi kesilir, sonra hepsi dikilir... Hafta sonu topluca biter."},
          ].map(s=>(
            <div key={s.id} onClick={()=>upUE("strateji",s.id)}
              style={{background:ue.strateji===s.id?`${C.cyan}10`:"rgba(255,255,255,0.02)",
              border:`1.5px solid ${ue.strateji===s.id?C.cyan+"50":C.border}`,
              borderRadius:10,padding:"10px 12px",cursor:"pointer",transition:"all .15s"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                <span style={{fontSize:16}}>{s.ikon}</span>
                <span style={{fontSize:12,fontWeight:700,color:ue.strateji===s.id?C.cyan:C.text}}>{s.baslik}</span>
                {ue.strateji===s.id&&<span style={{fontSize:9,color:C.cyan,marginLeft:"auto"}}>✓ Seçili</span>}
              </div>
              <div style={{fontSize:10,color:C.muted,lineHeight:1.4}}>{s.aciklama}</div>
            </div>
          ))}
        </div>
        {ue.strateji==="gunluk"&&tahmin&&(
          <div style={{fontSize:10,color:C.muted,marginTop:6,padding:"6px 10px",
            background:"rgba(255,255,255,0.02)",borderRadius:7}}>
            📊 Günlük kapasite ile: <strong style={{color:C.cyan}}>{ue.adet||1} adet</strong> için her gün tam döngü tamamlanır
          </div>
        )}
        {ue.strateji==="haftalik"&&tahmin&&(
          <div style={{fontSize:10,color:C.muted,marginTop:6,padding:"6px 10px",
            background:"rgba(255,255,255,0.02)",borderRadius:7}}>
            📊 Batch üretim: <strong style={{color:C.gold}}>{ue.adet||1} adet</strong> toplu aşamalarla işlenir, son gün tümü hazır
          </div>
        )}
      </div>

      {/* ── MALZEME KONTROLÜ ── */}
      {ue.urunId&&malzemeListesi.length>0&&(
        <div style={{background:eksikVar?`${C.coral}07`:`${C.mint}07`,
          border:`1px solid ${eksikVar?C.coral+"30":C.mint+"30"}`,
          borderRadius:12,padding:"12px 14px",marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
            <span style={{fontSize:13}}>{eksikVar?"⚠️":"✅"}</span>
            <span style={{fontSize:11,fontWeight:700,color:eksikVar?C.coral:C.mint}}>
              {eksikVar?"Malzeme Eksik":"Tüm Malzemeler Mevcut"}
            </span>
          </div>
          {/* Debug tablosu */}
          {malzemeDebug.length>0&&(
            <div style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"8px",marginBottom:8,
              fontSize:10,fontFamily:"monospace",maxHeight:120,overflowY:"auto"}}>
              <div style={{color:C.gold,marginBottom:4,fontWeight:700}}>🔍 Hesap Detayı:</div>
              {malzemeDebug.map((d,i)=>(
                <div key={i} style={{color:C.muted,marginBottom:2}}>
                  <span style={{color:C.text}}>{d.ad}</span>: {d.bomMiktar}{d.bomBirim}
                  {d.boyUzunluk&&<span style={{color:C.sky}}> (boy={d.boyUzunluk}cm)</span>}
                  {" → "}<span style={{color:C.cyan}}>{d.bomMiktarStok?.toFixed(4)}{d.stokBirim}</span>
                  {" × "}{ue.adet||1}adet × carpan={d.carpan}
                  {" = "}<span style={{color:C.gold,fontWeight:700}}>{d.gereken?.toFixed(3)}{d.stokBirim}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {malzemeListesi.filter(m=>!m.yeterli).map(m=>(
              <div key={m.id} style={{background:`${C.coral}08`,borderRadius:7,
                padding:"6px 10px",marginBottom:2}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:11,color:C.text,fontWeight:600}}>{m.ad}</span>
                  <div style={{display:"flex",gap:8,fontSize:10,alignItems:"center"}}>
                    <span style={{color:C.muted}}>Stok: <strong style={{color:C.gold}}>{fmt(m.mevcut)} {m.birim}</strong></span>
                    <span style={{color:C.muted}}>Gerek: <strong style={{color:C.coral}}>{fmt(m.gereken)} {m.birim}</strong></span>
                    <span style={{color:C.coral,fontWeight:700,minWidth:50}}>-{fmt(m.eksik)} {m.birim}</span>
                  </div>
                </div>
                <div style={{marginTop:4,fontSize:9,color:C.muted}}>
                  → Bu malzemeyi tedarik listesine eklemek için üretim emrini kaydet
                </div>
              </div>
            ))}
            {malzemeListesi.filter(m=>m.yeterli).map(m=>(
              <div key={m.id} style={{display:"flex",justifyContent:"space-between",
                alignItems:"center",padding:"3px 10px",opacity:0.6}}>
                <span style={{fontSize:10,color:C.muted}}>✓ {m.ad}</span>
                <span style={{fontSize:10,color:C.mint}}>{m.mevcut} {m.birim}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Üretim aşamaları */}
      <div style={{marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <span style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:1,textTransform:"uppercase"}}>
            Üretim Aşamaları {ue.asamalar?.length>0&&`(${ue.asamalar.length})`}
          </span>
          <button onClick={()=>upUE("asamalar",[...(ue.asamalar||[]),{id:uid(),ad:"Yeni Aşama",durum:"bekliyor",calisan:"",sureDk:0,fason:false}])}
            style={{background:`${C.cyan}12`,border:`1px solid ${C.cyan}25`,borderRadius:7,
            padding:"4px 10px",fontSize:11,color:C.cyan,cursor:"pointer"}}>+ Ekle</button>
        </div>
        {(!ue.asamalar||ue.asamalar.length===0)&&(
          <div style={{textAlign:"center",color:C.muted,fontSize:12,padding:"16px",
            background:"rgba(255,255,255,0.02)",borderRadius:8,border:`1px dashed ${C.border}`}}>
            Ürün seçince aşamalar otomatik gelir
          </div>
        )}
        {(ue.asamalar||[]).map((asama,ai)=>(
          <div key={asama.id} style={{background:asama.fason?`${C.lav}06`:"rgba(255,255,255,0.02)",
            border:`1px solid ${asama.fason?C.lav+"20":C.border}`,borderRadius:9,
            padding:"8px 12px",marginBottom:6}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,alignItems:"center"}}>
              {/* Aşama adı */}
              <input value={asama.ad} onChange={e=>upUE("asamalar",(ue.asamalar).map((a,i)=>i===ai?{...a,ad:e.target.value}:a))}
                style={{...INP,padding:"6px 10px",fontSize:12}}/>
              {/* Çalışan */}
              <select value={asama.calisan}
                onChange={e=>upUE("asamalar",(ue.asamalar).map((a,i)=>i===ai?{...a,calisan:e.target.value}:a))}
                style={{background:C.s3,border:`1px solid ${C.border}`,borderRadius:7,
                  padding:"6px 10px",fontSize:12,color:asama.calisan?C.text:C.muted,cursor:"pointer"}}>
                <option value="">{asama.fason?"Fason firma...":"Çalışan seç..."}</option>
                {asama.fason
                  ? <option value="—">— (Fason firma)</option>
                  : (calisanlar||[]).filter(c=>c.durum==="aktif").map(c=>
                      <option key={c.id} value={c.ad}>{c.ad}</option>)
                }
              </select>
              {/* Sil butonu */}
              <button onClick={()=>upUE("asamalar",(ue.asamalar).filter((_,i)=>i!==ai))}
                style={{background:`${C.coral}10`,border:`1px solid ${C.coral}20`,
                  borderRadius:7,width:28,height:28,cursor:"pointer",color:C.coral,fontSize:14,
                  display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>×</button>
            </div>
            <div style={{display:"flex",gap:8,marginTop:6,alignItems:"center"}}>
              <span style={{fontSize:10,color:C.muted}}>
                {asama.fason?"🏭 Fason":"👤 İç"} ·{" "}
                {asama.sureDk>0?(asama.sureDk>=60?Math.floor(asama.sureDk/60)+"dk"+(asama.sureDk%60>0?" "+asama.sureDk%60+"sn":""):asama.sureDk+"sn"):"Süre girilmemiş"}
              </span>
              <label style={{fontSize:10,color:C.muted,display:"flex",alignItems:"center",gap:4,cursor:"pointer",marginLeft:"auto"}}>
                <input type="checkbox" checked={!!asama.fason}
                  onChange={e=>upUE("asamalar",(ue.asamalar).map((a,i)=>i===ai?{...a,fason:e.target.checked}:a))}/>
                Fason
              </label>
            </div>
          </div>
        ))}
      </div>

      <Field label="Not">
        <input value={ue.notlar||""} onChange={e=>upUE("notlar",e.target.value)}
          placeholder="Opsiyonel not..." style={INP}/>
      </Field>

      {/* Footer */}
      <div style={{display:"flex",gap:8,justifyContent:"space-between",marginTop:16,alignItems:"center"}}>
        {duzenleme&&(
          <button onClick={handleSil} style={{background:silOnay?C.coral:`${C.coral}12`,
            border:`1px solid ${silOnay?C.coral:C.coral+"30"}`,borderRadius:9,
            padding:"9px 16px",fontSize:12,fontWeight:600,
            color:silOnay?"#000":C.coral,cursor:"pointer",transition:"all .2s"}}>
            {silOnay?"Emin misin? Tekrar bas":"🗑 Sil"}
          </button>
        )}
        <div style={{display:"flex",gap:8,marginLeft:"auto"}}>
          <Btn onClick={onClose}>İptal</Btn>
          <Btn variant="primary" onClick={handleSave}>
            {duzenleme?"Kaydet":"Oluştur"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

// ══ MODAL DISPATCHER ══════════════════════════════════════════════════════════


// ── MÜŞTERİ MODAL ────────────────────────────────────────────────────────────
// Hem yeni ekleme hem düzenleme (musteriDetay)
// Veri modeli:
//   tip: "bayi" | "direkt" | "kurumsal"
//   bayi ise: bayiAdi (hangi distribütör), altMusteriler: [{id,ad,adres,il,yetkili,tel,nakliyeciTercihi,teslimatGunu,randevuGerekli,notlar}]
//   direkt/kurumsal ise: subeler: [{id,ad,adres,il,yetkili,tel,nakliyeciTercihi,teslimatGunu,randevuGerekli,notlar}]

const NAKLIYECI_SECENEKLER = [
  "Müşteri kendi alıyor",
  "Kendi aracımız",
  "Ambar",
  "Özel nakliyeci",
  "Yurtiçi Kargo",
  "Aras Kargo",
  "MNG Kargo",
];

const TESLIMAT_GUNLERI = ["Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi","Her gün","Randevuya göre"];

function AltForm({altForm, setAltForm, listKey, tipBayi, setF}) {
  if(!altForm) return null;
  const isEdit = !!altForm.id;
  const [af, setAf] = useState({...altForm});
  const upA = (k,v) => setAf(p=>({...p,[k]:v}));

  const LBL = {fontSize:10,fontWeight:600,color:"rgba(237,232,223,.45)",
    marginBottom:5,letterSpacing:.3};
  const INP = {background:"#0D1117",border:"1px solid rgba(255,255,255,0.12)",
    borderRadius:8,padding:"9px 11px",fontSize:12,color:"#EDE8DF",width:"100%"};
  const SEL = {...INP,cursor:"pointer",
    appearance:"none",WebkitAppearance:"none",
    backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='rgba(237%2C232%2C223%2C.4)'/%3E%3C/svg%3E")`,
    backgroundRepeat:"no-repeat",backgroundPosition:"right 10px center",
    backgroundSize:"10px",paddingRight:30};

  return(
    <div style={{background:"rgba(255,255,255,0.025)",
      border:"1px solid rgba(255,255,255,0.09)",
      borderRadius:10,padding:"14px 16px",marginTop:6}}>

      <div style={{fontSize:11,fontWeight:700,color:"#E8914A",marginBottom:12,
        display:"flex",alignItems:"center",gap:6}}>
        <span>{isEdit?"✏️":"＋"}</span>
        {isEdit?"Düzenle — ":"Yeni "}{tipBayi?"Alt Müşteri":"Teslimat Noktası"}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
        <div>
          <div style={LBL}>{tipBayi?"MÜŞTERİ ADI *":"NOKTA / ŞUBE ADI *"}</div>
          <input value={af.ad||""} onChange={e=>upA("ad",e.target.value)} style={INP}
            placeholder={tipBayi?"Anpa Gross, Zırhlı Gross...":"Merkez, İstanbul Şubesi..."}/>
        </div>
        <div>
          <div style={LBL}>YETKİLİ</div>
          <input value={af.yetkili||""} onChange={e=>upA("yetkili",e.target.value)} style={INP}
            placeholder="Ad Soyad"/>
        </div>
      </div>

      <div style={{marginBottom:8}}>
        <div style={LBL}>TESLİMAT ADRESİ</div>
        <input value={af.adres||""} onChange={e=>upA("adres",e.target.value)} style={INP}
          placeholder="Sokak, mahalle, no..."/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
        <div>
          <div style={LBL}>İL</div>
          <input value={af.il||""} onChange={e=>upA("il",e.target.value)} style={INP}
            placeholder="İstanbul, Ankara..."/>
        </div>
        <div>
          <div style={LBL}>TELEFON</div>
          <input value={af.tel||""} onChange={e=>upA("tel",e.target.value)} style={INP}
            placeholder="0xxx xxx xx xx"/>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
        <div>
          <div style={LBL}>NAKLİYECİ TERCİHİ</div>
          <select value={af.nakliyeciTercihi||""} onChange={e=>upA("nakliyeciTercihi",e.target.value)} style={SEL}>
            <option value="">— Seçin —</option>
            {NAKLIYECI_SECENEKLER.map(n=><option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <div style={LBL}>TESLİMAT GÜNÜ</div>
          <select value={af.teslimatGunu||""} onChange={e=>upA("teslimatGunu",e.target.value)} style={SEL}>
            <option value="">— Seçin —</option>
            {TESLIMAT_GUNLERI.map(g=><option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      </div>

      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,
        background:"rgba(255,255,255,.02)",borderRadius:7,padding:"8px 10px"}}>
        <input type="checkbox" id={"randevu-"+( altForm?.id||"new")}
          checked={!!af.randevuGerekli}
          onChange={e=>upA("randevuGerekli",e.target.checked)}
          style={{accentColor:"#E8914A",width:14,height:14,cursor:"pointer"}}/>
        <label htmlFor={"randevu-"+(altForm?.id||"new")}
          style={{fontSize:11,color:"rgba(237,232,223,.6)",cursor:"pointer"}}>
          Teslimat için randevu gerekli
        </label>
      </div>

      <div style={{marginBottom:12}}>
        <div style={LBL}>NOT / ÖZEL TALİMAT</div>
        <input value={af.notlar||""} onChange={e=>upA("notlar",e.target.value)} style={INP}
          placeholder="Kapı kodu, özel istekler..."/>
      </div>

      <div style={{display:"flex",gap:6,justifyContent:"space-between",alignItems:"center"}}>
        <div>
          {isEdit&&(
            <button onClick={()=>{
              setF(p=>({...p,[listKey]:(p[listKey]||[]).filter(x=>x.id!==af.id)}));
              setAltForm(null);
            }} style={{background:"rgba(224,92,92,.08)",border:"1px solid rgba(224,92,92,.2)",
              borderRadius:7,padding:"6px 12px",fontSize:10,color:"rgba(224,92,92,.7)",cursor:"pointer"}}>
              Sil
            </button>
          )}
        </div>
        <div style={{display:"flex",gap:6}}>
          <button onClick={()=>setAltForm(null)}
            style={{background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",
            borderRadius:7,padding:"6px 14px",fontSize:11,color:"rgba(237,232,223,.4)",cursor:"pointer"}}>
            İptal
          </button>
          <button onClick={()=>{
            if(!af.ad?.trim()){alert("Ad zorunlu");return;}
            const kayit = {...af, id:af.id||uid()};
            setF(p=>({...p,[listKey]:isEdit
              ?(p[listKey]||[]).map(x=>x.id===kayit.id?kayit:x)
              :[...(p[listKey]||[]),kayit]
            }));
            setAltForm(null);
          }} style={{background:"rgba(232,145,74,.15)",border:"1px solid rgba(232,145,74,.4)",
            borderRadius:7,padding:"6px 16px",fontSize:11,fontWeight:700,
            color:"#E8914A",cursor:"pointer"}}>
            ✓ Kaydet
          </button>
        </div>
      </div>
    </div>
  );
}

function MusteriModal({data, onClose, onSave, onDelete}){
  const duzenleme = !!data?.id;
  const [f, setF] = useState({
    id:data?.id||null, ad:data?.ad||"", tip:data?.tip||"direkt",
    yetkili:data?.yetkili||"", tel:data?.tel||"", email:data?.email||"",
    whatsapp:data?.whatsapp||"", vergiNo:data?.vergiNo||"",
    bayiAdi:data?.bayiAdi||"", notlar:data?.notlar||"",
    altMusteriler:data?.altMusteriler||[], subeler:data?.subeler||[],
  });
  const [altForm,  setAltForm]  = useState(null);
  const [silOnay,  setSilOnay]  = useState(false);
  const up = (k,v) => setF(p=>({...p,[k]:v}));

  const listKey   = f.tip==="bayi" ? "altMusteriler" : "subeler";
  const listLabel = f.tip==="bayi" ? "Alt Müşteriler" : "Teslimat Noktaları / Şubeler";
  const liste = f[listKey]||[];

  const LBL = {fontSize:10,fontWeight:600,color:"rgba(237,232,223,.5)",
    marginBottom:5,letterSpacing:.3};
  const INP = {background:"#0D1117",border:"1px solid rgba(255,255,255,0.1)",
    borderRadius:8,padding:"9px 11px",fontSize:12,color:"#EDE8DF",width:"100%"};

  const TIP_OPT = [
    {v:"direkt",   l:"🏪 Direkt Müşteri"},
    {v:"bayi",     l:"🏢 Bayi / Distribütör"},
    {v:"kurumsal", l:"🏛 Kurumsal"},
  ];

  return(
    <Modal title={duzenleme?"Müşteriyi Düzenle":"Yeni Müşteri"} onClose={onClose} width={600} maxHeight="88vh">

      {/* ── TİP SEÇİMİ ── */}
      <div style={{display:"flex",gap:6,marginBottom:18}}>
        {TIP_OPT.map(t=>{
          const ak = f.tip===t.v;
          return(
            <button key={t.v} onClick={()=>up("tip",t.v)} style={{
              flex:1,padding:"9px 6px",borderRadius:9,cursor:"pointer",
              fontSize:11,fontWeight:600,transition:"all .15s",
              border:`1px solid ${ak?"rgba(232,145,74,.5)":"rgba(255,255,255,.06)"}`,
              background:ak?"rgba(232,145,74,.08)":"rgba(255,255,255,.03)",
              color:ak?"#E8914A":"rgba(237,232,223,.35)",
            }}>{t.l}</button>
          );
        })}
      </div>

      {/* ── ANA BİLGİLER ── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:4}}>
        <div style={{gridColumn:"1/-1"}}>
          <div style={LBL}>{f.tip==="bayi"?"FİRMA / BAYİ ADI *":"MÜŞTERİ ADI *"}</div>
          <input value={f.ad} onChange={e=>up("ad",e.target.value)} style={INP}
            placeholder={f.tip==="bayi"?"Timon, ABC Distribütör...":"Mağaza, şirket adı..."}/>
        </div>

        {f.tip==="bayi"&&(
          <div style={{gridColumn:"1/-1"}}>
            <div style={LBL}>KANAL / ANA FİRMA</div>
            <input value={f.bayiAdi} onChange={e=>up("bayiAdi",e.target.value)} style={INP}
              placeholder="Bu müşteriye ulaşmak için kullanılan kanal (örn. Timon)"/>
          </div>
        )}

        <div>
          <div style={LBL}>YETKİLİ KİŞİ</div>
          <input value={f.yetkili} onChange={e=>up("yetkili",e.target.value)} style={INP}
            placeholder="Ad Soyad"/>
        </div>
        <div>
          <div style={LBL}>TELEFON</div>
          <input value={f.tel} onChange={e=>up("tel",e.target.value)} style={INP}
            placeholder="0xxx xxx xx xx"/>
        </div>
        <div>
          <div style={LBL}>E-POSTA</div>
          <input value={f.email} onChange={e=>up("email",e.target.value)} style={INP}
            placeholder="ornek@firma.com"/>
        </div>
        <div>
          <div style={LBL}>WHATSAPP</div>
          <input value={f.whatsapp} onChange={e=>up("whatsapp",e.target.value)} style={INP}
            placeholder="5xx xxx xx xx"/>
        </div>
        <div>
          <div style={LBL}>VERGİ NO</div>
          <input value={f.vergiNo} onChange={e=>up("vergiNo",e.target.value)} style={INP}/>
        </div>
        <div>
          <div style={LBL}>NOT</div>
          <input value={f.notlar} onChange={e=>up("notlar",e.target.value)} style={INP}
            placeholder="Özel notlar..."/>
        </div>
      </div>

      {/* ── ALT MÜŞTERİLER / ŞUBELER ── */}
      <div style={{marginTop:18,paddingTop:16,borderTop:"1px solid rgba(255,255,255,0.06)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:700,color:"#EDE8DF",letterSpacing:.3}}>
            {listLabel}
            <span style={{fontSize:10,color:"rgba(237,232,223,.3)",fontWeight:400,marginLeft:6}}>
              ({liste.length})
            </span>
          </div>
          {!altForm&&(
            <button onClick={()=>setAltForm({
              id:null,ad:"",adres:"",il:"",yetkili:"",tel:"",
              nakliyeciTercihi:"",teslimatGunu:"",randevuGerekli:false,notlar:""
            })} style={{fontSize:10,fontWeight:700,
              background:"rgba(232,145,74,.1)",border:"1px solid rgba(232,145,74,.3)",
              borderRadius:7,padding:"5px 12px",color:"#E8914A",cursor:"pointer"}}>
              + Ekle
            </button>
          )}
        </div>

        {/* Liste */}
        <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:8}}>
          {liste.map((item)=>(
            <div key={item.id} style={{
              display:"flex",justifyContent:"space-between",alignItems:"center",
              background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",
              borderRadius:9,padding:"9px 12px"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:600,color:"#EDE8DF",marginBottom:2}}>{item.ad}</div>
                <div style={{display:"flex",gap:8,fontSize:10,color:"rgba(237,232,223,.4)",flexWrap:"wrap"}}>
                  {item.il&&<span>📍 {item.il}</span>}
                  {item.nakliyeciTercihi&&<span>🚚 {item.nakliyeciTercihi}</span>}
                  {item.teslimatGunu&&<span>📅 {item.teslimatGunu}</span>}
                  {item.randevuGerekli&&<span style={{color:"#E8914A"}}>📋 Randevu</span>}
                  {item.yetkili&&<span>👤 {item.yetkili}</span>}
                </div>
              </div>
              <button onClick={()=>setAltForm(item)}
                style={{fontSize:10,background:"rgba(255,255,255,.04)",
                border:"1px solid rgba(255,255,255,.08)",borderRadius:6,
                padding:"4px 10px",color:"rgba(237,232,223,.4)",cursor:"pointer",marginLeft:8}}>
                Düzenle
              </button>
            </div>
          ))}
          {liste.length===0&&!altForm&&(
            <div style={{textAlign:"center",padding:"20px",fontSize:11,
              color:"rgba(237,232,223,.2)",background:"rgba(255,255,255,.02)",
              borderRadius:9,border:"1px dashed rgba(255,255,255,.06)"}}>
              {f.tip==="bayi"
                ?"Alt müşteri yok — Anpa, Zırhlı gibi noktaları ekleyin"
                :"Teslimat noktası yok — şube veya adres ekleyin"}
            </div>
          )}
        </div>

        <AltForm
          key={altForm?.id||"new"}
          altForm={altForm}
          setAltForm={setAltForm}
          listKey={listKey}
          tipBayi={f.tip==="bayi"}
          setF={setF}
        />
      </div>

      {/* ── FOOTER ── */}
      <div style={{display:"flex",gap:8,justifyContent:"space-between",
        marginTop:18,paddingTop:14,borderTop:"1px solid rgba(255,255,255,0.06)"}}>
        <div>
          {duzenleme&&(
            <button onClick={()=>{
              if(silOnay){onDelete(f.id);}
              else{setSilOnay(true);setTimeout(()=>setSilOnay(false),3000);}
            }} style={{
              background:silOnay?"rgba(224,92,92,.15)":"rgba(224,92,92,.04)",
              border:`1px solid ${silOnay?"rgba(224,92,92,.5)":"rgba(224,92,92,.12)"}`,
              borderRadius:8,padding:"8px 14px",fontSize:11,cursor:"pointer",
              color:silOnay?"#E05C5C":"rgba(224,92,92,.4)"}}>
              {silOnay?"Evet, Sil ":"Sil"}
            </button>
          )}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={onClose} style={{
            background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.08)",
            borderRadius:8,padding:"9px 18px",fontSize:12,
            color:"rgba(237,232,223,.4)",cursor:"pointer"}}>
            İptal
          </button>
          <button onClick={()=>{
            if(!f.ad?.trim()){alert("Müşteri adı zorunlu");return;}
            onSave({...f,id:f.id||uid()});
            onClose();
          }} style={{
            background:"linear-gradient(135deg,rgba(232,145,74,.25),rgba(232,145,74,.15))",
            border:"1px solid rgba(232,145,74,.5)",borderRadius:8,
            padding:"9px 22px",fontSize:12,fontWeight:700,color:"#E8914A",cursor:"pointer"}}>
            ✓ {duzenleme?"Güncelle":"Kaydet"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── TEDARİK SİPARİŞ MODAL (Adım 2 — Tam Veri Modeli) ─────────────────────────
function TedarikSiparisModal({m, onClose, onKaydet, hamMaddeler=[], hizmetler=[]}){
  const hmKalem = hamMaddeler.find(h=>h.id===m?.id);
  const [f, setF] = useState({
    miktar: m ? String(m.toplamEksik) : "",
    siparisYontemi: "telefon",
    sevkiyatYontemi: hmKalem?.sevkiyatYontemi || "tedarikci_getirir",
    nakliyeci: hmKalem?.nakliye?.varsayilanNakliyeci || "",
    nakliyeTel: hmKalem?.nakliye?.nakliyeTel || "",
    nakliyeUcret: "",
    nakliyeNot: "",
    beklenenTarih: "",
    teslimatYeri: hmKalem?.fasona_gider_mi ? "fason" : "depo",
    fasonFirmaId: hmKalem?.fasonHedefId || "",
    not: "",
  });
  const up = (k,v) => setF(p=>({...p,[k]:v}));

  // Tahmini teslim tarihi hesapla
  const tahminiGun = hmKalem?.tahminiTeslimGun || 0;
  const bugun = new Date();
  const tahminiTarih = tahminiGun > 0
    ? new Date(bugun.getTime() + tahminiGun * 86400000).toISOString().slice(0,10)
    : "";

  // Fason firma bilgisi
  const fasonFirma = hizmetler.find(h=>h.id===f.fasonFirmaId);

  if(!m) return null;
  const INP = {background:C.s3,border:`1px solid ${C.border}`,borderRadius:8,
    padding:"8px 10px",fontSize:13,color:C.text,width:"100%"};
  const SEL = {...INP, cursor:"pointer"};

  return(
    <Modal title="🛒 Tedarik Siparişi Oluştur" onClose={onClose} width={540} maxHeight="85vh">
      {/* Tedarikçi başlık */}
      <div style={{background:"rgba(62,123,212,.06)",border:"1px solid rgba(62,123,212,.2)",
        borderRadius:10,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:18}}>📦</span>
        <div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:700,color:C.text}}>{m.tedarikci||"Tedarikçi Belirtilmemiş"}</div>
          <div style={{fontSize:11,color:C.muted}}>{m.ad}</div>
        </div>
      </div>

      {/* Sipariş Kalemleri */}
      <div style={{background:"rgba(255,255,255,.02)",border:`1px solid ${C.border}`,
        borderRadius:10,padding:"10px 14px",marginBottom:12}}>
        <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase",marginBottom:8}}>
          Sipariş Kalemleri
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
          padding:"8px 10px",background:"rgba(255,255,255,.03)",borderRadius:8}}>
          <div>
            <div style={{fontSize:12,fontWeight:600,color:C.text}}>{m.ad}</div>
            <div style={{fontSize:10,color:C.muted}}>
              {m.ueListesi?.map(ue=>ue.ueKod).join(", ")||"—"}
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <input type="number" value={f.miktar} onChange={e=>up("miktar",e.target.value)} step="0.001"
              style={{...INP,width:90,textAlign:"right",padding:"6px 8px"}}/>
            <span style={{fontSize:11,color:C.muted}}>{m.birim}</span>
          </div>
        </div>
        <div style={{fontSize:9,color:C.muted,marginTop:4,paddingLeft:10}}>
          Eksik: {fmt(m.toplamEksik)} {m.birim}
          {hmKalem?.minSiparisMiktar>0&&<span style={{color:C.gold}}> · Min sipariş: {hmKalem.minSiparisMiktar} {m.birim}</span>}
        </div>
      </div>

      {/* Sipariş Yöntemi */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
        <div>
          <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Sipariş Yöntemi</div>
          <select value={f.siparisYontemi} onChange={e=>up("siparisYontemi",e.target.value)} style={SEL}>
            <option value="telefon">📞 Telefon</option>
            <option value="whatsapp">💬 WhatsApp</option>
            <option value="email">✉️ E-posta</option>
            <option value="portal">🌐 Portal</option>
          </select>
        </div>
        <div>
          <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Beklenen Teslim</div>
          <input type="date" value={f.beklenenTarih||tahminiTarih}
            onChange={e=>up("beklenenTarih",e.target.value)} style={INP}/>
          {tahminiGun>0&&!f.beklenenTarih&&(
            <div style={{fontSize:9,color:C.sky,marginTop:2}}>⏱ ~{tahminiGun} gün (otomatik)</div>
          )}
        </div>
      </div>

      {/* Sevkiyat */}
      <div style={{background:"rgba(232,145,74,.04)",border:"1px solid rgba(232,145,74,.15)",
        borderRadius:10,padding:"10px 14px",marginBottom:12}}>
        <div style={{fontSize:10,fontWeight:700,color:"#E8914A",letterSpacing:.5,textTransform:"uppercase",marginBottom:8}}>
          🚚 Sevkiyat
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
            <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Sevkiyat Yöntemi</div>
            <select value={f.sevkiyatYontemi} onChange={e=>up("sevkiyatYontemi",e.target.value)} style={SEL}>
              <option value="tedarikci_getirir">🏪 Tedarikçi getiriyor</option>
              <option value="ben_alirim">🏃 Ben alıyorum</option>
              <option value="nakliye">🚚 Nakliye</option>
              <option value="kargo">📦 Kargo</option>
            </select>
          </div>
          <div>
            <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Teslimat Yeri</div>
            <select value={f.teslimatYeri} onChange={e=>up("teslimatYeri",e.target.value)} style={SEL}>
              <option value="depo">🏠 Depoya</option>
              <option value="fason">🏭 Direkt Fasona</option>
            </select>
          </div>
        </div>

        {/* Nakliye detayları */}
        {f.sevkiyatYontemi==="nakliye"&&(
          <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div>
                <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Nakliyeci</div>
                <input value={f.nakliyeci} onChange={e=>up("nakliyeci",e.target.value)}
                  placeholder="Ahmet Nakliyat" style={INP}/>
              </div>
              <div>
                <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Nakliye Ücreti (₺)</div>
                <input type="number" value={f.nakliyeUcret} onChange={e=>up("nakliyeUcret",e.target.value)}
                  placeholder="500" style={INP}/>
              </div>
            </div>
          </div>
        )}

        {/* Fason yönlendirme */}
        {f.teslimatYeri==="fason"&&(
          <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
            <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Fason Firma</div>
            <select value={f.fasonFirmaId} onChange={e=>up("fasonFirmaId",e.target.value)} style={SEL}>
              <option value="">— Fason firma seçin —</option>
              {hizmetler.filter(h=>h.tip==="fason").map(h=>(
                <option key={h.id} value={h.id}>{h.ad}{h.firma?` — ${h.firma}`:""}</option>
              ))}
            </select>
            {fasonFirma&&(
              <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>
                <span style={{fontSize:9,background:`${C.lav}12`,color:C.lav,borderRadius:4,padding:"2px 6px"}}>
                  🏭 {fasonFirma.firma||fasonFirma.ad}
                </span>
                {fasonFirma.sureGun>0&&<span style={{fontSize:9,background:`${C.gold}12`,color:C.gold,borderRadius:4,padding:"2px 6px"}}>
                  ⏱ ~{fasonFirma.sureGun} gün
                </span>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Not */}
      <div style={{marginBottom:16}}>
        <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Not</div>
        <input type="text" value={f.not} onChange={e=>up("not",e.target.value)}
          placeholder="Fiyat, tedarikçi notu..." style={INP}/>
      </div>

      {/* Ödeme vadesi bilgisi */}
      {hmKalem?.odemeVadesi>0&&(
        <div style={{fontSize:10,color:C.muted,marginBottom:12,padding:"6px 10px",
          background:"rgba(255,255,255,.02)",borderRadius:7}}>
          💳 Ödeme vadesi: <strong style={{color:C.gold}}>{hmKalem.odemeVadesi} gün</strong>
        </div>
      )}

      {/* Butonlar */}
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.05)",border:`1px solid ${C.border}`,
          borderRadius:8,padding:"8px 16px",fontSize:12,color:C.muted,cursor:"pointer"}}>İptal</button>
        <button onClick={()=>{
          const miktar2 = parseFloat(String(f.miktar).replace(",","."))||0;
          if(miktar2<=0){alert("Miktar giriniz");return;}

          // Tedarik siparişi objesi oluştur
          const siparis = {
            id: "ts-" + Date.now() + "-" + Math.random().toString(36).slice(2,6),
            durum: "siparis_verildi",
            olusturmaAt: new Date().toISOString(),
            kalemler: [{
              hamMaddeId: m.id,
              ad: m.ad,
              miktar: miktar2,
              birim: m.birim,
              birimFiyat: hmKalem?.listeFiyat||0,
              toplamFiyat: null,
              ueListesi: m.ueListesi?.map(ue=>ue.ueKod)||[],
            }],
            tedarikci: m.tedarikci||"",
            tedarikciTel: "",
            siparisYontemi: f.siparisYontemi,
            sevkiyatYontemi: f.sevkiyatYontemi,
            nakliyeci: f.nakliyeci,
            nakliyeUcret: parseFloat(f.nakliyeUcret)||0,
            nakliyeNot: "",
            siparisVerildiAt: new Date().toISOString(),
            beklenenTeslimAt: f.beklenenTarih||tahminiTarih||null,
            teslimAlindiAt: null,
            fasonYonlendirme: f.teslimatYeri==="fason" ? {
              gidecekMi: true,
              fasonFirmaId: f.fasonFirmaId,
              fasonFirmaAd: fasonFirma?.ad||"",
              gonderimAt: null,
              teslimAt: null,
              fasonNot: "",
            } : {gidecekMi:false},
            not: f.not,
            faturaNo: "",
            faturaAt: null,
            vadeTarih: hmKalem?.odemeVadesi ? new Date(Date.now()+hmKalem.odemeVadesi*86400000).toISOString().slice(0,10) : null,
            odendiMi: false,
          };

          onKaydet(siparis);
          onClose();
        }} style={{background:`${C.cyan}20`,border:`1px solid ${C.cyan}40`,
          borderRadius:8,padding:"8px 18px",fontSize:12,fontWeight:700,color:C.cyan,cursor:"pointer"}}>
          ✓ Siparişi Oluştur
        </button>
      </div>
    </Modal>
  );
}

// ── TEDARİK GİRİŞ / TESLİM ALMA MODAL (Adım 2) ──────────────────────────────
function TedarikGirisModal({m, onClose, onKaydet, hamMaddeler=[], hizmetler=[], tedarikSiparisleri=[]}){
  const hmKalem = hamMaddeler.find(h=>h.id===m?.id);
  // İlgili tedarik siparişini bul
  const ilgiliSiparis = tedarikSiparisleri.find(ts=>
    ts.durum==="siparis_verildi"&&ts.kalemler?.some(k=>k.hamMaddeId===m?.id)
  );

  const [f, setF] = useState({
    miktar: m ? String(m.toplamEksik) : "",
    beklenenTarih: m?.beklenenTarih||"",
    // Nakliye kaydı
    nakliyeci: ilgiliSiparis?.nakliyeci || hmKalem?.nakliye?.varsayilanNakliyeci || "",
    nakliyeTel: hmKalem?.nakliye?.nakliyeTel || "",
    nakliyeUcret: ilgiliSiparis?.nakliyeUcret ? String(ilgiliSiparis.nakliyeUcret) : "",
    // Yönlendirme
    yonlendirme: hmKalem?.fasona_gider_mi ? "fason" : "depo",
    fasonFirmaId: hmKalem?.fasonHedefId || "",
    // Fatura
    faturaNo: "",
    vadeGun: hmKalem?.odemeVadesi ? String(hmKalem.odemeVadesi) : "",
  });
  const up = (k,v) => setF(p=>({...p,[k]:v}));

  if(!m) return null;
  const INP = {background:C.s3,border:`1px solid ${C.border}`,borderRadius:8,
    padding:"8px 10px",fontSize:13,color:C.text,width:"100%"};
  const gelenMiktar = parseFloat(String(f.miktar).replace(",",".")) || 0;
  const kalanEksik  = Math.max(0, m.toplamEksik - gelenMiktar);
  const nakliyeUcretNum = parseFloat(f.nakliyeUcret)||0;
  const birimNakliye = nakliyeUcretNum>0&&gelenMiktar>0 ? (nakliyeUcretNum/gelenMiktar) : 0;
  const fasonFirma = hizmetler.find(h=>h.id===f.fasonFirmaId);

  return(
    <Modal title="📥 Teslim Alma" onClose={onClose} width={540} maxHeight="85vh">
      {/* Başlık */}
      <div style={{background:"rgba(61,184,138,.06)",border:"1px solid rgba(61,184,138,.2)",
        borderRadius:10,padding:"10px 14px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:18}}>📥</span>
        <div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:700,color:C.text}}>{m.ad}</div>
          <div style={{fontSize:11,color:C.muted}}>{m.tedarikci||"—"}
            {ilgiliSiparis&&<span style={{color:C.sky}}> · {ilgiliSiparis.id}</span>}
          </div>
        </div>
      </div>

      {/* Gelen Kalemler */}
      <div style={{background:"rgba(255,255,255,.02)",border:`1px solid ${C.border}`,
        borderRadius:10,padding:"10px 14px",marginBottom:12}}>
        <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase",marginBottom:8}}>
          Gelen Kalemler
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,alignItems:"center",
          padding:"8px 10px",background:"rgba(255,255,255,.03)",borderRadius:8}}>
          <div>
            <div style={{fontSize:12,fontWeight:600,color:C.text}}>{m.ad}</div>
            <div style={{display:"flex",gap:10,fontSize:10,color:C.muted,marginTop:2}}>
              <span>Stok: <strong style={{color:C.text}}>{fmt(m.mevcut)} {m.birim}</strong></span>
              <span>Gerek: <strong style={{color:C.gold}}>{fmt(m.toplamGereken)} {m.birim}</strong></span>
              <span style={{color:C.coral}}>Eksik: <strong>{fmt(m.toplamEksik)} {m.birim}</strong></span>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:4}}>
            <span style={{fontSize:10,color:C.muted}}>Gelen:</span>
            <input type="number" value={f.miktar} onChange={e=>up("miktar",e.target.value)} step="0.001"
              style={{...INP,width:90,textAlign:"right",padding:"6px 8px",fontWeight:700}}/>
            <span style={{fontSize:11,color:C.muted}}>{m.birim}</span>
          </div>
        </div>
        {gelenMiktar>0&&<div style={{fontSize:10,marginTop:6,paddingLeft:10,
          color:kalanEksik<=0?C.mint:C.gold,fontWeight:600}}>
          {kalanEksik<=0 ? "✅ Tüm eksik karşılanacak"
            : `⚡ Kısmi giriş — ${fmt(kalanEksik)} ${m.birim} hâlâ eksik kalacak`}
        </div>}
      </div>

      {/* Nakliye Kaydı */}
      <div style={{background:"rgba(232,145,74,.04)",border:"1px solid rgba(232,145,74,.15)",
        borderRadius:10,padding:"10px 14px",marginBottom:12}}>
        <div style={{fontSize:10,fontWeight:700,color:"#E8914A",letterSpacing:.5,textTransform:"uppercase",marginBottom:8}}>
          🚚 Nakliye Kaydı
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
            <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Nakliyeci</div>
            <input value={f.nakliyeci} onChange={e=>up("nakliyeci",e.target.value)}
              placeholder="Ahmet Nakliyat" style={INP}/>
          </div>
          <div>
            <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Ücret (₺)</div>
            <input type="number" value={f.nakliyeUcret} onChange={e=>up("nakliyeUcret",e.target.value)}
              placeholder="500" style={INP}/>
          </div>
        </div>
        {birimNakliye>0&&(
          <div style={{marginTop:6,fontSize:11,color:"#E8914A",fontWeight:600}}>
            → {birimNakliye.toFixed(2)}₺/{m.birim} (otomatik hesap)
          </div>
        )}
      </div>

      {/* Yönlendirme */}
      <div style={{background:f.yonlendirme==="fason"?"rgba(124,92,191,.06)":"rgba(255,255,255,.02)",
        border:`1px solid ${f.yonlendirme==="fason"?"rgba(124,92,191,.2)":C.border}`,
        borderRadius:10,padding:"10px 14px",marginBottom:12}}>
        <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase",marginBottom:8}}>
          📍 Yönlendirme
        </div>
        <div style={{display:"flex",gap:8,marginBottom:f.yonlendirme==="fason"?10:0}}>
          {[["depo","🏠 Depoya koy (stoka ekle)"],["fason","🏭 Direkt fasona gönder"]].map(([v,l])=>(
            <button key={v} onClick={()=>up("yonlendirme",v)} style={{
              flex:1,padding:"8px 10px",borderRadius:8,cursor:"pointer",
              border:`1px solid ${f.yonlendirme===v?(v==="fason"?C.lav:C.mint)+"50":C.border}`,
              background:f.yonlendirme===v?`${v==="fason"?C.lav:C.mint}10`:"rgba(255,255,255,.02)",
              color:f.yonlendirme===v?(v==="fason"?C.lav:C.mint):C.muted,
              fontSize:11,fontWeight:f.yonlendirme===v?600:400,transition:"all .15s"
            }}>{l}</button>
          ))}
        </div>
        {f.yonlendirme==="fason"&&(
          <div>
            <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Fason Firma</div>
            <select value={f.fasonFirmaId} onChange={e=>up("fasonFirmaId",e.target.value)}
              style={{...INP,cursor:"pointer"}}>
              <option value="">— Fason firma seçin —</option>
              {hizmetler.filter(h=>h.tip==="fason").map(h=>(
                <option key={h.id} value={h.id}>{h.ad}{h.firma?` — ${h.firma}`:""}</option>
              ))}
            </select>
            {fasonFirma&&(
              <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>
                <span style={{fontSize:9,background:`${C.lav}12`,color:C.lav,borderRadius:4,padding:"2px 6px"}}>
                  🏭 {fasonFirma.firma||fasonFirma.ad}
                </span>
                {fasonFirma.sureGun>0&&<span style={{fontSize:9,background:`${C.gold}12`,color:C.gold,borderRadius:4,padding:"2px 6px"}}>
                  ⏱ ~{fasonFirma.sureGun} gün
                </span>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fatura (opsiyonel) */}
      <div style={{background:"rgba(255,255,255,.02)",border:`1px solid ${C.border}`,
        borderRadius:10,padding:"10px 14px",marginBottom:12}}>
        <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:.5,textTransform:"uppercase",marginBottom:8}}>
          🧾 Fatura (opsiyonel)
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
            <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Fatura No</div>
            <input value={f.faturaNo} onChange={e=>up("faturaNo",e.target.value)}
              placeholder="F-2024-0341" style={INP}/>
          </div>
          <div>
            <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Vade (gün)</div>
            <input type="number" value={f.vadeGun} onChange={e=>up("vadeGun",e.target.value)}
              placeholder="30" style={INP}/>
          </div>
        </div>
      </div>

      {/* Kalan için beklenen tarih */}
      {kalanEksik>0&&(
        <div style={{marginBottom:12}}>
          <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Kalan için Beklenen Tarih</div>
          <input type="date" value={f.beklenenTarih} onChange={e=>up("beklenenTarih",e.target.value)} style={INP}/>
        </div>
      )}

      {/* Butonlar */}
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.05)",border:`1px solid ${C.border}`,
          borderRadius:8,padding:"8px 16px",fontSize:12,color:C.muted,cursor:"pointer"}}>İptal</button>
        <button onClick={()=>{
          if(gelenMiktar<=0){alert("Miktar giriniz");return;}

          // Nakliye kaydı oluştur
          const nakliyeKaydi = (f.nakliyeci||nakliyeUcretNum>0) ? {
            id: "nk-" + Date.now() + "-" + Math.random().toString(36).slice(2,6),
            tarih: new Date().toISOString().slice(0,10),
            nakliyeci: f.nakliyeci,
            nakliyeciTel: f.nakliyeTel,
            ucret: nakliyeUcretNum,
            kalemler: [{hamMaddeId:m.id, ad:m.ad, miktar:gelenMiktar, birim:m.birim}],
            nereden: m.tedarikci||"Tedarikçi",
            nereye: f.yonlendirme==="fason" ? (fasonFirma?.ad||"Fason") : "Atölye",
            tedarikSiparisId: ilgiliSiparis?.id||null,
            not: "",
          } : null;

          onKaydet({
            gelenMiktar,
            kalanEksik,
            beklenenTarih: kalanEksik>0?f.beklenenTarih:"",
            yonlendirme: f.yonlendirme,
            fasonFirmaId: f.fasonFirmaId,
            fasonFirmaAd: fasonFirma?.ad||"",
            nakliyeKaydi,
            faturaNo: f.faturaNo,
            vadeGun: parseInt(f.vadeGun)||0,
            ilgiliSiparisId: ilgiliSiparis?.id||null,
          });
          onClose();
        }} style={{background:`${C.mint}20`,border:`1px solid ${C.mint}40`,
          borderRadius:8,padding:"8px 18px",fontSize:12,fontWeight:700,color:C.mint,cursor:"pointer"}}>
          ✓ Teslim Al
        </button>
      </div>
    </Modal>
  );
}

function ModalDispatch({modal,setModal,...props}){
  const close=()=>setModal(null);
  const {type,data}=modal;

  // ─ Müşteri ─
  if(type==="yeniMusteri"||type==="musteriDetay"){
    const isEdit = type==="musteriDetay"&&!!data?.id;
    return <MusteriModal data={isEdit?data:{...data}} onClose={close}
      onSave={m=>{props.setMusteriler(p=>isEdit?p.map(x=>x.id===m.id?m:x):[...p,m]);close();}}
      onDelete={id=>{props.setMusteriler(p=>p.filter(x=>x.id!==id));close();}}/>;
  }
  // ─ Yeni Sipariş ─
  if(type==="yeniSiparis"||type==="siparisDuzenle"){
    return <SiparisModal data={data} onClose={close} setSiparisler={props.setSiparisler} isEdit={type==="siparisDuzenle"} urunler={props.urunler} musteriler={props.musteriler} hamMaddeler={props.hamMaddeler} yarimamulList={props.yarimamulList} siparisler={props.siparisler}/>;
  }
  // ─ Sipariş Durum ─
  if(type==="siparisDurum"){
    return <SiparisDurumModal data={data} onClose={close} setSiparisler={props.setSiparisler}/>;
  }
  // ─ Stok ─
  if(type==="yeniStok"||type==="stokDuzenle"){
    return <StokModal data={data} onClose={close} setStok={props.setStok} isEdit={type==="stokDuzenle"}/>;
  }
  if(type==="stokGiris"){
    return <StokGirisModal data={data} onClose={close} setStok={props.setStok}/>;
  }
  // ─ Yeni stok kalem tipi ─
  if(type==="yeniStokKalem"||type==="duzenleHam"||type==="yeniHam"){
    const isEdit=type==="duzenleHam"&&!!data?.id;
    return <HamMaddeModal kalem={isEdit?data:data?._kopya?data:null}
      hamMaddeler={props.hamMaddeler} yarimamulList={props.yarimamulList}
      hizmetler={props.hizmetler||[]}
      onClose={close}
      onSave={f=>{props.setHamMaddeler(p=>isEdit?p.map(x=>x.id===f.id?f:x):[...p,{...f,id:uid()}]);close();}}
      onKopya={f=>{setModal({type:"yeniHam",data:{...f,id:null,kod:f.kod+"-K",ad:f.ad+" - Kopya",miktar:0,_kopya:true}});}}
      onDelete={id=>{props.setHamMaddeler(p=>p.filter(x=>x.id!==id));close();}}/>;
  }
  if(type==="duzenleYM"||type==="yeniYM"){
    const isEdit=type==="duzenleYM"&&!!data?.id;
    return <YariMamulModal kalem={isEdit?data:data?._kopya?data:null} hamMaddeler={props.hamMaddeler} yarimamulList={props.yarimamulList}
      hizmetler={props.hizmetler} onClose={close}
      onSave={f=>{props.setYM(p=>isEdit?p.map(x=>x.id===f.id?f:x):[...p,{...f,id:uid()}]);close();}}
      onKopya={f=>{setModal({type:"yeniYM",data:{...f,id:null,kod:f.kod+"-K",ad:f.ad+" - Kopya",miktar:0,_kopya:true,bom:(f.bom||[]).map(b=>({...b,id:uid()}))}});}}
      onDelete={id=>{props.setYM(p=>p.filter(x=>x.id!==id));close();}}/>;
  }
  if(type==="duzenleUrunBom"||type==="yeniUrunBom"){
    const isEdit=type==="duzenleUrunBom"&&!!data?.id;
    return <UrunBomModal kalem={isEdit?data:data?._kopya?data:null} hamMaddeler={props.hamMaddeler} yarimamulList={props.yarimamulList}
      hizmetler={props.hizmetler} onClose={close}
      onSave={f=>{
        props.setUrunler(p=>isEdit
          ? p.map(x=>x.id===f.id?{...x,...f}:x)
          : [...p,{...f,id:uid(),satisKdvDahil:f.satisKdvDahil||0,satisKdv:f.satisKdv||10,gelirVergisi:30,aktif:true,stok:0,minStok:0}]
        );
        close();
      }}
      onKopya={f=>{setModal({type:"yeniUrunBom",data:{...f,id:null,kod:f.kod+"-K",ad:f.ad+" - Kopya",stok:0,_kopya:true,bom:(f.bom||[]).map(b=>({...b,id:uid()}))}});}}
      onDelete={id=>{props.setUrunler(p=>p.filter(x=>x.id!==id));close();}}/>;
  }
  // Fason hizmet (dışarıdan alınan)
  if(type==="yeniFasonHizmet"||type==="duzenleFasonHizmet"){
    const isEdit=type==="duzenleFasonHizmet";
    return <FasonHizmetModal kalem={isEdit?data:null} onClose={close}
      onSave={f=>{props.setHizmetler(p=>isEdit?p.map(x=>x.id===f.id?f:x):[...p,{...f,id:uid(),tip:"fason"}]);close();}}
      onDelete={id=>{props.setHizmetler(p=>p.filter(x=>x.id!==id));close();}}/>;
  }
  // İç işçilik
  if(type==="yeniIscilikHizmet"||type==="duzenleIscilikHizmet"){
    const isEdit=type==="duzenleIscilikHizmet";
    return <IscilikModal kalem={isEdit?data:null} istasyonlar={props.istasyonlar} calisanlar={props.calisanlar} onClose={close}
      onSave={f=>{props.setHizmetler(p=>isEdit?p.map(x=>x.id===f.id?f:x):[...p,{...f,id:uid(),tip:"ic"}]);close();}}
      onDelete={id=>{props.setHizmetler(p=>p.filter(x=>x.id!==id));close();}}/>;
  }
  // Eski tip (geriye dönük uyumluluk)
  if(type==="duzenleHizmet"){
    const isEdit=!!data?.id;
    if(data?.tip==="ic") return <IscilikModal kalem={data} istasyonlar={props.istasyonlar} calisanlar={props.calisanlar} onClose={close}
      onSave={f=>{props.setHizmetler(p=>p.map(x=>x.id===f.id?f:x));close();}}
      onDelete={id=>{props.setHizmetler(p=>p.filter(x=>x.id!==id));close();}}/>;
    return <FasonHizmetModal kalem={data} onClose={close}
      onSave={f=>{props.setHizmetler(p=>p.map(x=>x.id===f.id?f:x));close();}}
      onDelete={id=>{props.setHizmetler(p=>p.filter(x=>x.id!==id));close();}}/>;
  }
  // ─ İstasyon ─
  if(type==="yeniIstasyon"||type==="istasyonDuzenle"){
    return <IstasyonModal data={data} onClose={close} setIstasyonlar={props.setIstasyonlar} isEdit={type==="istasyonDuzenle"}/>;
  }
  // ─ Çalışan ─
  if(type==="yeniCalisan"||type==="calisanDuzenle"){
    return <CalisanModal data={data} onClose={close} setCalisanlar={props.setCalisanlar} isEdit={type==="calisanDuzenle"}/>;
  }
  // ─ Fason ─
  if(type==="yeniFason"||type==="fasonDuzenle"){
    return <FasonModal data={data} onClose={close} setFasonFirmalar={props.setFasonFirmalar} isEdit={type==="fasonDuzenle"}/>;
  }
  // ─ Ürün ─
  if(type==="yeniUrun"||type==="urunDuzenle"){
    return <UrunModal data={data} onClose={close} setUrunler={props.setUrunler} isEdit={type==="urunDuzenle"&&!!data?.id}
      hamMaddeler={props.hamMaddeler} yarimamulList={props.yarimamulList} hizmetler={props.hizmetler}/>;
  }
  // ─ Toplu UE Önizleme ─
  if(type==="topluUEOnizleme"){
    const sp = data;
    const sonuc = topluUEOlustur(sp, {urunler:props.urunler, hamMaddeler:props.hamMaddeler, yarimamulList:props.yarimamulList, hizmetler:[...(props.hizmetler||[]),...(props.urunler||[]).flatMap(u=>(u.bom||[]).filter(b=>b.tip==="hizmet").map(b=>b))], uretimEmirleri:props.uretimEmirleri, siparisler:props.siparisler});
    const {ueler, malzemeler} = sonuc;
    const eksikMalz = malzemeler.filter(m=>m.eksik>0);
    const yeterliMalz = malzemeler.filter(m=>m.eksik<=0);
    // Tedarikçi bazlı gruplama
    const tedGrp = {};
    eksikMalz.forEach(m=>{const hm=(props.hamMaddeler||[]).find(x=>x.id===m.id);const ted=hm?.tedarikci||"Belirtilmemiş";if(!tedGrp[ted])tedGrp[ted]=[];tedGrp[ted].push({...m,tedarikci:ted,hmBirim:hm?.birim||m.birim});});


    return(
      <Modal title={"🏭 Üretim Emri Önizleme — "+sp.id} onClose={close} width={650} maxHeight="85vh">
        {/* UE Listesi */}
        <div style={{marginBottom:16}}>
          <div style={{fontSize:12,fontWeight:700,color:C.cyan,marginBottom:8}}>Oluşturulacak Üretim Emirleri ({ueler.length})</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {ueler.map((ue,i)=>{
              const ur=(props.urunler||[]).find(x=>x.id===ue.urunId);
              return(<div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",borderRadius:8,background:C.cyan+"08",border:"1px solid "+C.cyan+"18"}}>
                <div>
                  <div style={{fontSize:12,fontWeight:700,color:C.text}}>{ue.kod} — {ue.urunAd}</div>
                  <div style={{fontSize:10,color:C.muted,marginTop:1}}>{ue.asamalar.length} aşama · {ue.eksikMalzemeler.length>0?ue.eksikMalzemeler.length+" eksik malzeme":"Malzeme tamam"}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:16,fontWeight:800,color:C.cyan,fontFamily:"'Montserrat',sans-serif"}}>{ue.adet}</div>
                  <div style={{fontSize:9,color:C.muted}}>adet üretim</div>
                </div>
              </div>);
            })}
          </div>
        </div>

        {/* Eksik Malzeme Listesi — tedarikçi bazlı */}
        {eksikMalz.length>0&&(
          <div style={{marginBottom:16}}>
            <div style={{fontSize:12,fontWeight:700,color:C.coral,marginBottom:8}}>⚠ Eksik Malzemeler ({eksikMalz.length} kalem)</div>
            {Object.entries(tedGrp).map(([ted,malzList])=>(
              <div key={ted} style={{marginBottom:10}}>
                <div style={{fontSize:10,fontWeight:700,color:C.gold,marginBottom:4,display:"flex",alignItems:"center",gap:6}}>
                  <span>📦 {ted}</span>
                  <span style={{fontSize:9,color:C.muted}}>{malzList.length} kalem</span>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:3}}>
                  {malzList.map((m,mi)=>(<div key={mi} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 10px",borderRadius:6,background:"rgba(255,255,255,.02)",border:"1px solid "+C.border,fontSize:11}}>
                    <span style={{color:C.text,fontWeight:600}}>{m.ad}</span>
                    <div style={{display:"flex",gap:10,alignItems:"center"}}>
                      <span style={{color:C.muted}}>Stok: {Number(m.mevcut).toFixed(1)}</span>
                      <span style={{color:C.gold}}>Gerek: {Number(m.gereken).toFixed(1)}</span>
                      <span style={{color:C.coral,fontWeight:700}}>Eksik: {Number(m.eksik).toFixed(1)} {m.hmBirim}</span>
                    </div>
                  </div>))}
                </div>
              </div>
            ))}
          </div>
        )}

        {eksikMalz.length===0&&malzemeler.length>0&&(
          <div style={{padding:"10px 14px",borderRadius:8,background:C.mint+"08",border:"1px solid "+C.mint+"20",marginBottom:16,fontSize:12,color:C.mint,fontWeight:600}}>
            ✅ Tüm malzemeler stokta mevcut
          </div>
        )}

        {/* Stokta yeterli malzemeler — özet */}
        {yeterliMalz.length>0&&(
          <div style={{marginBottom:16,background:C.mint+"06",border:"1px solid "+C.mint+"15",borderRadius:8,padding:"8px 14px"}}>
            <details>
              <summary style={{fontSize:11,fontWeight:600,color:C.mint,cursor:"pointer",userSelect:"none"}}>
                ✅ Stokta Yeterli ({yeterliMalz.length} kalem) — detay için tıkla
              </summary>
              <div style={{display:"flex",flexWrap:"wrap",gap:3,marginTop:6}}>
                {yeterliMalz.map((m,mi)=>(
                  <span key={mi} style={{fontSize:9,background:C.mint+"0C",border:"1px solid "+C.mint+"18",borderRadius:4,padding:"2px 6px",color:C.mint}}>
                    {m.ad}: {Number(m.gereken).toFixed(1)} / stok {Number(m.mevcut).toFixed(1)}
                  </span>
                ))}
              </div>
            </details>
          </div>
        )}


        {ueler.length===0&&(
          <div style={{padding:"16px",textAlign:"center",color:C.mint,fontSize:13}}>
            ✅ Tüm ürünler stoktan karşılanıyor — üretim emri gerekmez.
          </div>
        )}

        <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}>
          <Btn onClick={close}>İptal</Btn>
          {ueler.length>0&&<Btn variant="primary" onClick={()=>{
            props.setUretimEmirleri(p=>[...p,...ueler]);
            props.setSiparisler(p=>p.map(s=>s.id===sp.id?{...s,durum:"uretimde"}:s));
            close();
          }}>✓ {ueler.length} Üretim Emri Oluştur</Btn>}
        </div>
      </Modal>
    );
  }

  // ─ Üretim Emri ─
  if(type==="yeniUretimEmri"||type==="ueDetay"){
    const duzenleme=type==="ueDetay";
    const init=duzenleme?data:{
      id:uid(),kod:"UE-"+String((props.uretimEmirleri||[]).length+1).padStart(3,"0"),
      urunId:(data||{}).urunId||"",urunAd:((data||{}).urunId?(props.urunler||[]).find(x=>x.id===(data||{}).urunId):null)?.ad||(data||{}).urunAd||"",adet:(data||{}).uretilecek||(data||{}).adet||1,durum:"bekliyor",
      sipNo:(data||{}).sipNo||"",termin:(data||{}).termin||"",notlar:(data||{}).sipNo?("Sipariş: "+(data||{}).sipNo):"",
      asamalar:[],
      olusturmaTarihi:new Date().toISOString()
    };
    return <UretimEmriModal init={init} duzenleme={duzenleme} onClose={close}
      urunler={props.urunler} urunBomList={props.urunBomList} calisanlar={props.calisanlar}
      hizmetler={props.hizmetler} yarimamulList={props.yarimamulList}
      hamMaddeler={props.hamMaddeler}
      setUretimEmirleri={props.setUretimEmirleri} setAktifUE={props.setAktifUE}/>;
  }

  // ─ Otomatik Kod Olustur ─
  if(type==="otomatikKod"){
    return <OtomatikKodModal
      urunler={props.urunler} hamMaddeler={props.hamMaddeler}
      yarimamulList={props.yarimamulList} hizmetler={props.hizmetler}
      urunBomList={props.urunBomList}
      onClose={close}
      onApply={(kodMap)=>{
        props.setHamMaddeler(p=>p.map(x=>kodMap[x.id]?{...x,kod:kodMap[x.id]}:x));
        props.setYM(p=>p.map(x=>kodMap[x.id]?{...x,kod:kodMap[x.id]}:x));
        props.setUrunBomList(p=>p.map(x=>kodMap[x.id]?{...x,kod:kodMap[x.id]}:x));
        props.setHizmetler(p=>p.map(x=>kodMap[x.id]?{...x,kod:kodMap[x.id]}:x));
        props.setUrunler(p=>p.map(x=>kodMap[x.id]?{...x,kod:kodMap[x.id]}:x));
        close();
      }}
    />;
  }
  return null;
}

// ── MODAL: SİPARİŞ ────────────────────────────────────────────────────────────
function SiparisModal({data,onClose,setSiparisler,isEdit,urunler=[],musteriler=[],hamMaddeler=[],yarimamulList=[],siparisler=[]}){
  const [siparisAdi,setSiparisAdi]=useState(data.siparisAdi||data.urun||"");
  const [musteriId,setMusteriId]=useState(data.musteriId||"");
  const [musteri,setMusteri]=useState(data.musteri||"");
  const [kalemler,setKalemler]=useState(()=>{
    if(data.kalemler?.length) return data.kalemler.map(k=>({...k,_id:k._id||uid()}));
    if(data.urunId) return [{_id:uid(),urunId:data.urunId,adet:data.adet||1,altMusteriAd:""}];
    return [{_id:uid(),urunId:"",adet:1,altMusteriAd:""}];
  });
  const [termin,setTermin]=useState(data.termin||"");
  const [durum,setDurum]=useState(data.durum||"bekliyor");
  const [notlar,setNotlar]=useState(data.notlar||"");

  // Müşteri objesi
  const musteriObj = musteriler.find(m=>m.id===musteriId);
  const isDistributor = musteriObj?.tip==="bayi";
  const altMusteriler = isDistributor ? (musteriObj?.altMusteriler||musteriObj?.bayiler||[]) : [];

  // Müşteri seçildiğinde
  const handleMusteriSec = (mId) => {
    const m = musteriler.find(x=>x.id===mId);
    setMusteriId(mId);
    setMusteri(m?.ad||"");
  };

  // Kalem işlemleri
  const kalemEkle = () => setKalemler(p=>[...p,{_id:uid(),urunId:"",adet:1,altMusteriAd:""}]);
  const kalemSil = (_id) => setKalemler(p=>p.length>1?p.filter(k=>k._id!==_id):p);
  const kalemGuncelle = (_id,field,val) => setKalemler(p=>p.map(k=>k._id===_id?{...k,[field]:val}:k));

  // Stok analizi — kümülatif kalem bazlı
  const analizler = useMemo(()=>{
    return siparisKalemAnalizleri(
      kalemler.filter(k=>k.urunId&&k.adet>0),
      siparisler, isEdit?data.id:null,
      urunler, hamMaddeler, yarimamulList
    );
  },[kalemler,siparisler,urunler,hamMaddeler,yarimamulList]);

  // Filtrelenmiş kalemler (analiz eşleşmesi için)
  const gecerliKalemler = kalemler.filter(k=>k.urunId&&k.adet>0);

  // Üretim özeti — aynı ürünler birleştirilmiş
  const uretimOzeti = useMemo(()=>{
    const map = {};
    gecerliKalemler.forEach((k,i)=>{
      const a = analizler?.[i];
      if(!a) return;
      if(!map[k.urunId]) map[k.urunId]={urunId:k.urunId,toplamAdet:0,toplamStok:0,toplamUretim:0};
      map[k.urunId].toplamAdet += (k.adet||0);
      map[k.urunId].toplamStok += (a.stokKarsilanan||0);
      map[k.urunId].toplamUretim += (a.uretilecek||0);
    });
    return Object.values(map);
  },[gecerliKalemler,analizler]);

  const tumStokYeterli = uretimOzeti.every(o=>o.toplamUretim===0);
  const toplamAdet = kalemler.reduce((s,k)=>s+(k.adet||0),0);

  // Kaydet
  const save = () => {
    if(!siparisAdi.trim()){alert("Sipariş adı zorunlu!");return;}
    if(!musteri.trim()&&!musteriId){alert("Müşteri seçiniz!");return;}
    if(gecerliKalemler.length===0){alert("En az 1 ürün kalemi ekleyin!");return;}

    const spKalemler = gecerliKalemler.map((k,i)=>{
      const a = analizler?.[i] || {};
      const ur = urunler.find(x=>x.id===k.urunId);
      return {
        urunId:k.urunId, urunAd:ur?.ad||"", adet:k.adet,
        altMusteriAd:k.altMusteriAd||"",
        stokKarsilanan: a.stokKarsilanan||0,
        uretilecek: a.uretilecek||0,
        eksikHamMaddeler: a.eksikHamMaddeler||[],
      };
    });

    const hedefDurum = isEdit ? durum : "bekliyor";

    if(isEdit){
      setSiparisler(p=>p.map(s=>s.id===data.id?{
        ...s, siparisAdi, musteri, musteriId, kalemler:spKalemler,
        adet:toplamAdet, termin, durum:hedefDurum, notlar,
      }:s));
    } else {
      setSiparisler(p=>[...p,{
        id:`SP-${uid().toUpperCase().slice(0,5)}`,
        siparisAdi, musteri, musteriId, kalemler:spKalemler,
        adet:toplamAdet, termin, durum:hedefDurum, notlar,
        asamalar:[], olusturmaTarihi:new Date().toISOString(),
      }]);
    }
    onClose();
  };

  return(
    <Modal title={isEdit?"Sipariş Düzenle":"Yeni Sipariş"} onClose={onClose} width={680} maxHeight="90vh">
      {/* Sipariş Adı */}
      <Field label="SİPARİŞ ADI">
        <TextInp value={siparisAdi} onChange={setSiparisAdi} placeholder="Örn: Anpa Ocak Siparişi"/>
      </Field>

      {/* Müşteri */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
        <Field label="MÜŞTERİ" style={{marginBottom:0}}>
          <select value={musteriId} onChange={e=>handleMusteriSec(e.target.value)}
            style={{width:"100%",background:C.s3,border:`1px solid ${C.border}`,borderRadius:9,
              padding:"9px 12px",fontSize:13,color:C.text,cursor:"pointer"}}>
            <option value="">— Müşteri seçin —</option>
            {musteriler.map(m=><option key={m.id} value={m.id}>{m.ad}{m.tip==="bayi"?" (Distribütör)":""}</option>)}
          </select>
          {!musteriId&&<input value={musteri} onChange={e=>setMusteri(e.target.value)}
            placeholder="veya manuel yazın..."
            style={{marginTop:4,width:"100%",background:"rgba(255,255,255,.04)",border:`1px solid ${C.border}`,
              borderRadius:8,padding:"7px 10px",fontSize:12,color:C.text}}/>}
        </Field>
        <Field label="TERMİN" style={{marginBottom:0}}>
          <input type="date" value={termin} onChange={e=>setTermin(e.target.value)}
            style={{width:"100%",background:C.s3,border:`1px solid ${C.border}`,borderRadius:9,
              padding:"9px 12px",fontSize:13,color:C.text,colorScheme:"dark"}}/>
        </Field>
      </div>

      {isDistributor&&<div style={{background:`${C.lav}0C`,border:`1px solid ${C.lav}25`,borderRadius:8,
        padding:"6px 12px",marginBottom:12,fontSize:11,color:C.lav,display:"flex",alignItems:"center",gap:6}}>
        <span style={{fontSize:14}}>🏪</span> Distribütör müşteri — kalem bazında alt müşteri seçebilirsiniz
        <span style={{background:`${C.lav}20`,borderRadius:4,padding:"1px 6px",fontSize:10,fontWeight:700,marginLeft:"auto"}}>{altMusteriler.length} alt müşteri</span>
      </div>}

      {/* Kalemler */}
      <div style={{marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <span style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:.5}}>ÜRÜN KALEMLERİ ({kalemler.length})</span>
          <button onClick={kalemEkle} style={{background:`${C.cyan}10`,border:`1px solid ${C.cyan}25`,
            borderRadius:7,padding:"4px 12px",fontSize:11,fontWeight:700,color:C.cyan,cursor:"pointer"}}>+ Kalem Ekle</button>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {kalemler.map((k,ki)=>{
            const ur = urunler.find(x=>x.id===k.urunId);
            const gecerliIdx = gecerliKalemler.findIndex(gk=>gk._id===k._id);
            const analiz = gecerliIdx>=0 ? analizler?.[gecerliIdx] : null;
            return(
              <div key={k._id} style={{background:"rgba(255,255,255,.025)",border:`1px solid ${C.border}`,
                borderRadius:11,padding:"10px 12px",animation:"fade-up .2s ease"}}>
                {/* Üst satır */}
                <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                  {isDistributor&&altMusteriler.length>0&&(
                    <div style={{minWidth:120}}>
                      <div style={{fontSize:9,color:C.lav,fontWeight:600,marginBottom:3}}>Alt Müşteri</div>
                      <select value={k.altMusteriAd||""} onChange={e=>kalemGuncelle(k._id,"altMusteriAd",e.target.value)}
                        style={{width:"100%",background:C.s3,border:`1px solid ${C.lav}30`,borderRadius:7,
                          padding:"6px 8px",fontSize:11,color:C.text,cursor:"pointer"}}>
                        <option value="">— Genel —</option>
                        {altMusteriler.map((am,ai)=><option key={ai} value={am.ad}>{am.ad}</option>)}
                      </select>
                    </div>
                  )}
                  <div style={{flex:1}}>
                    <div style={{fontSize:9,color:C.muted,fontWeight:600,marginBottom:3}}>Ürün</div>
                    <select value={k.urunId} onChange={e=>kalemGuncelle(k._id,"urunId",e.target.value)}
                      style={{width:"100%",background:C.s3,border:`1px solid ${C.border}`,borderRadius:7,
                        padding:"6px 8px",fontSize:12,color:C.text,cursor:"pointer"}}>
                      <option value="">— Ürün seçin —</option>
                      {urunler.map(u=><option key={u.id} value={u.id}>{u.ad} {u.stok>0?`(stok: ${u.stok})`:""}</option>)}
                    </select>
                  </div>
                  <div style={{width:80}}>
                    <div style={{fontSize:9,color:C.muted,fontWeight:600,marginBottom:3}}>Adet</div>
                    <input type="number" min={1} value={k.adet} onChange={e=>kalemGuncelle(k._id,"adet",parseInt(e.target.value)||1)}
                      style={{width:"100%",background:C.s3,border:`1px solid ${C.border}`,borderRadius:7,
                        padding:"6px 8px",fontSize:13,color:C.text,textAlign:"center"}}/>
                  </div>
                  {kalemler.length>1&&(
                    <button onClick={()=>kalemSil(k._id)} style={{background:"none",border:"none",
                      cursor:"pointer",color:C.coral,fontSize:16,lineHeight:1,marginTop:16,padding:"0 4px"}}>×</button>
                  )}
                </div>

                {/* Stok analizi */}
                {analiz&&k.urunId&&(
                  <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${C.border}`}}>
                    <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                      <span style={{fontSize:10,color:C.muted}}>Kullanılabilir stok: <strong style={{color:C.text}}>{analiz.stokMiktar}</strong></span>
                      {analiz.stokKarsilanan>0&&<span style={{fontSize:9,background:`${C.mint}12`,color:C.mint,
                        borderRadius:4,padding:"1px 6px",fontWeight:700}}>✓ Stoktan {analiz.stokKarsilanan}</span>}
                      {analiz.uretilecek>0&&<span style={{fontSize:9,background:`${C.gold}12`,color:C.gold,
                        borderRadius:4,padding:"1px 6px",fontWeight:700}}>🏭 Üretilecek {analiz.uretilecek}</span>}
                      {analiz.stokYeterli&&<span style={{fontSize:9,color:C.mint}}>✅ Tamam</span>}
                    </div>
                    {/* Eksik ham madde uyarısı */}
                    {analiz.eksikHamMaddeler?.filter(m=>!m.yeterli).length>0&&(
                      <div style={{marginTop:5,display:"flex",flexWrap:"wrap",gap:4}}>
                        {analiz.eksikHamMaddeler.filter(m=>!m.yeterli).slice(0,3).map((m,mi)=>(
                          <span key={mi} style={{fontSize:9,background:`${C.coral}10`,color:C.coral,
                            borderRadius:4,padding:"1px 6px"}}>⚠ {m.ad}: -{Number(m.eksik).toFixed(1)} {m.birim}</span>
                        ))}
                        {analiz.eksikHamMaddeler.filter(m=>!m.yeterli).length>3&&(
                          <span style={{fontSize:9,color:C.muted}}>+{analiz.eksikHamMaddeler.filter(m=>!m.yeterli).length-3} daha</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Üretim Özeti */}
      {uretimOzeti.length>0&&(
        <div style={{background:"rgba(255,255,255,.02)",border:`1px solid ${C.border}`,borderRadius:10,
          padding:"10px 14px",marginBottom:14}}>
          <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:.5,marginBottom:6}}>ÜRETİM ÖZETİ</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
            {uretimOzeti.map((o,i)=>{
              const ur=urunler.find(x=>x.id===o.urunId);
              const pct=o.toplamAdet>0?Math.round(o.toplamStok/o.toplamAdet*100):0;
              return(
                <div key={i} style={{background:"rgba(255,255,255,.03)",border:`1px solid ${C.border}`,
                  borderRadius:8,padding:"6px 10px",minWidth:130}}>
                  <div style={{fontSize:11,fontWeight:600,color:C.text,marginBottom:3,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ur?.ad||"?"}</div>
                  <div style={{height:3,borderRadius:2,background:C.border,marginBottom:3}}>
                    <div style={{height:"100%",borderRadius:2,width:`${pct}%`,
                      background:pct===100?C.mint:C.gold,transition:"width .3s"}}/>
                  </div>
                  <div style={{display:"flex",gap:4,fontSize:9}}>
                    <span style={{color:C.text,fontWeight:700}}>{o.toplamAdet} adet</span>
                    {o.toplamStok>0&&<span style={{color:C.mint}}>stok {o.toplamStok}</span>}
                    {o.toplamUretim>0&&<span style={{color:C.gold}}>üretim {o.toplamUretim}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Durum (sadece düzenlemede) */}
      {isEdit&&(
        <Field label="DURUM">
          <Select value={durum} onChange={setDurum} options={[
            {value:"bekliyor",label:"Bekliyor"},{value:"hazir",label:"Sevkiyata Hazır"},
            {value:"uretimde",label:"Üretimde"},{value:"bloke",label:"Bloke"},
            {value:"sevk_edildi",label:"Sevk Edildi"},{value:"tamamlandi",label:"Tamamlandı"},
            {value:"iptal",label:"İptal"}]}/>
        </Field>
      )}

      {/* Notlar */}
      <Field label="NOTLAR">
        <textarea value={notlar} onChange={e=>setNotlar(e.target.value)} placeholder="Notlar..." rows={2}
          style={{width:"100%",background:"rgba(255,255,255,.04)",border:`1px solid ${C.border}`,borderRadius:9,
            padding:"9px 12px",fontSize:13,color:C.text,resize:"vertical",fontFamily:FB}}/>
      </Field>

      {/* Footer */}
      <div style={{display:"flex",gap:8,justifyContent:"space-between",alignItems:"center",marginTop:6}}>
        <div style={{fontSize:11,color:C.muted}}>
          {toplamAdet} adet · {gecerliKalemler.length} kalem
          
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn onClick={onClose}>İptal</Btn>
          <Btn variant="primary" onClick={save}>
            {isEdit?"Kaydet":"Oluştur"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function SiparisDurumModal({data,onClose,setSiparisler}){
  const [durum,setDurum]=useState(data.durum);
  const [notlar,setNotlar]=useState(data.notlar||"");
  const save=()=>{
    setSiparisler(p=>p.map(s=>s.id===data.id?{...s,durum,notlar}:s));
    onClose();
  };
  return(
    <Modal title={`${data.id} — Durum Güncelle`} onClose={onClose} width={420}>
      <Field label="Yeni Durum">
        <Select value={durum} onChange={setDurum} options={[
          {value:"bekliyor",label:"Bekliyor"},
          {value:"hazir",label:"Sevkiyata Hazır"},
          {value:"uretimde",label:"Üretimde"},
          {value:"bloke",label:"Bloke"},
          {value:"sevk_edildi",label:"Sevk Edildi"},
          {value:"tamamlandi",label:"Tamamlandı"},
          {value:"iptal",label:"İptal"}]}/>
      </Field>
      <Field label="Not">
        <TextInp value={notlar} onChange={setNotlar} placeholder="Neden değişti?"/>
      </Field>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:6}}>
        <Btn onClick={onClose}>İptal</Btn>
        <Btn variant="primary" onClick={save}>Kaydet</Btn>
      </div>
    </Modal>
  );
}

// ── MODAL: STOK ───────────────────────────────────────────────────────────────
function StokModal({data,onClose,setStok,isEdit}){
  const [form,setForm]=useState({ad:data.ad||"",kategori:data.kategori||"",birim:data.birim||"adet",
    miktar:data.miktar||0,minStok:data.minStok||10,birimFiyat:data.birimFiyat||0,kdv:data.kdv||20});
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const save=()=>{
    if(!form.ad){alert("Malzeme adı zorunlu!");return;}
    if(isEdit){setStok(p=>p.map(s=>s.id===data.id?{...s,...form}:s));}
    else {setStok(p=>[...p,{id:uid(),...form}]);}
    onClose();
  };
  return(
    <Modal title={isEdit?"Stok Düzenle":"Yeni Stok Kalemi"} onClose={onClose}>
      <Field label="Malzeme Adı"><TextInp value={form.ad} onChange={v=>set("ad",v)} placeholder="Döşemelik Kumaş"/></Field>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Field label="Kategori"><TextInp value={form.kategori} onChange={v=>set("kategori",v)} placeholder="Döşeme"/></Field>
        <Field label="Birim"><TextInp value={form.birim} onChange={v=>set("birim",v)} placeholder="adet/mt/kg"/></Field>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Field label="Mevcut Miktar"><NumInp value={form.miktar} onChange={v=>set("miktar",v||0)} step={0.1} style={{width:"100%"}}/></Field>
        <Field label="Min Stok"><NumInp value={form.minStok} onChange={v=>set("minStok",v||0)} style={{width:"100%"}}/></Field>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Field label="Birim Fiyat (₺)"><NumInp value={form.birimFiyat} onChange={v=>set("birimFiyat",v||0)} step={0.01} style={{width:"100%"}}/></Field>
        <Field label="KDV %"><NumInp value={form.kdv} onChange={v=>set("kdv",v||0)} style={{width:"100%"}}/></Field>
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:6}}>
        <Btn onClick={onClose}>İptal</Btn>
        <Btn variant="primary" onClick={save}>{isEdit?"Kaydet":"Ekle"}</Btn>
      </div>
    </Modal>
  );
}

function StokGirisModal({data,onClose,setStok}){
  const [miktar,setMiktar]=useState(0);
  const save=()=>{
    const yeniMiktar=data.miktar+miktar;
    if(yeniMiktar<0){alert("Stok negatife dusmez. Mevcut: "+data.miktar+" "+data.birim);return;}
    setStok(p=>p.map(s=>s.id===data.id?{...s,miktar:yeniMiktar}:s));
    onClose();
  };
  return(
    <Modal title={`Stok Giriş — ${data.ad}`} onClose={onClose} width={380}>
      <div style={{fontSize:13,color:C.muted,marginBottom:16}}>Mevcut: {data.miktar} {data.birim}</div>
      <Field label={`Eklenecek Miktar (${data.birim})`}>
        <NumInp value={miktar} onChange={v=>setMiktar(v||0)} step={0.1} width={140}/>
      </Field>
      <div style={{background:`${C.mint}0D`,border:`1px solid ${C.mint}22`,borderRadius:10,padding:"10px 14px",marginBottom:16}}>
        <div style={{fontSize:12,color:C.muted}}>Yeni miktar:</div>
        <div style={{fontSize:18,fontWeight:800,color:C.mint,fontFamily:F}}>{data.miktar+miktar} {data.birim}</div>
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <Btn onClick={onClose}>İptal</Btn>
        <Btn variant="primary" color={C.mint} onClick={save}>Girişi Kaydet</Btn>
      </div>
    </Modal>
  );
}

// ── MODAL: İSTASYON ───────────────────────────────────────────────────────────
function IstasyonModal({data,onClose,setIstasyonlar,isEdit}){
  const [form,setForm]=useState({ad:data.ad||"",tip:data.tip||"ic",kapasite:data.kapasite||"",calisan:data.calisan||"",durum:data.durum||"aktif",notlar:data.notlar||""});
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const save=()=>{
    if(!form.ad){alert("İstasyon adı zorunlu!");return;}
    if(isEdit){setIstasyonlar(p=>p.map(x=>x.id===data.id?{...x,...form}:x));}
    else{setIstasyonlar(p=>[...p,{id:uid(),...form}]);}
    onClose();
  };
  return(
    <Modal title={isEdit?"İstasyon Düzenle":"Yeni İstasyon"} onClose={onClose}>
      <Field label="İstasyon Adı"><TextInp value={form.ad} onChange={v=>set("ad",v)} placeholder="Kesim Masası"/></Field>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Field label="Tip">
          <Select value={form.tip} onChange={v=>set("tip",v)} options={[{value:"ic",label:"İç İstasyon"},{value:"fason",label:"Fason"}]}/>
        </Field>
        <Field label="Durum">
          <Select value={form.durum} onChange={v=>set("durum",v)} options={[{value:"aktif",label:"Aktif"},{value:"pasif",label:"Pasif"},{value:"fason",label:"Fason"}]}/>
        </Field>
      </div>
      <Field label="Sorumlu Çalışan"><TextInp value={form.calisan} onChange={v=>set("calisan",v)} placeholder="Ahmet Usta"/></Field>
      <Field label="Kapasite"><TextInp value={form.kapasite} onChange={v=>set("kapasite",v)} placeholder="8 saat/gün"/></Field>
      <Field label="Notlar"><TextInp value={form.notlar} onChange={v=>set("notlar",v)} placeholder=""/></Field>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:6}}>
        <Btn onClick={onClose}>İptal</Btn>
        <Btn variant="primary" onClick={save}>{isEdit?"Kaydet":"Ekle"}</Btn>
      </div>
    </Modal>
  );
}

// ── MODAL: ÇALIŞAN ────────────────────────────────────────────────────────────
function CalisanModal({data,onClose,setCalisanlar,isEdit}){
  const [form,setForm]=useState({ad:data.ad||"",rol:data.rol||"",tel:data.tel||"",durum:data.durum||"aktif",istasyon:data.istasyon||""});
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const save=()=>{
    if(!form.ad){alert("Ad zorunlu!");return;}
    if(isEdit){setCalisanlar(p=>p.map(x=>x.id===data.id?{...x,...form}:x));}
    else{setCalisanlar(p=>[...p,{id:uid(),...form}]);}
    onClose();
  };
  const [silOnay,setSilOnay]=useState(false);
  const sil=()=>{
    if(silOnay){
      setCalisanlar(p=>p.filter(x=>x.id!==data.id));
      onClose();
    } else {
      setSilOnay(true);
      setTimeout(()=>setSilOnay(false),3000);
    }
  };
  return(
    <Modal title={isEdit?"Çalışan Düzenle":"Yeni Çalışan"} onClose={onClose}>
      <Field label="Ad Soyad"><TextInp value={form.ad} onChange={v=>set("ad",v)} placeholder="Ahmet Yılmaz"/></Field>
      <Field label="Rol / Ünvan"><TextInp value={form.rol} onChange={v=>set("rol",v)} placeholder="Döşemeci"/></Field>
      <Field label="Telefon"><TextInp value={form.tel} onChange={v=>set("tel",v)} placeholder="0532 xxx xx xx"/></Field>
      <Field label="Çalıştığı İstasyon(lar)"><TextInp value={form.istasyon} onChange={v=>set("istasyon",v)} placeholder="Döşeme Tezgahı / Montaj"/></Field>
      <Field label="Durum">
        <Select value={form.durum} onChange={v=>set("durum",v)} options={[{value:"aktif",label:"Aktif"},{value:"pasif",label:"Pasif"}]}/>
      </Field>
      <div style={{display:"flex",gap:8,justifyContent:"space-between",marginTop:6,alignItems:"center"}}>
        {isEdit&&(
          <button onClick={sil} style={{background:silOnay?C.coral:`${C.coral}12`,
            border:`1px solid ${silOnay?C.coral:C.coral+"35"}`,
            borderRadius:9,padding:"9px 16px",fontSize:13,fontWeight:600,
            color:silOnay?"#000":C.coral,cursor:"pointer",fontFamily:"inherit",
            transition:"all .2s"}}>
            {silOnay?"Emin misin? Tekrar bas":"🗑 Sil"}
          </button>
        )}
        <div style={{display:"flex",gap:8,marginLeft:"auto"}}>
          <Btn onClick={onClose}>İptal</Btn>
          <Btn variant="primary" onClick={save}>{isEdit?"Kaydet":"Ekle"}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ── MODAL: FASON ──────────────────────────────────────────────────────────────
function FasonModal({data,onClose,setFasonFirmalar,isEdit}){
  const [form,setForm]=useState({ad:data.ad||"",tip:data.tip||"",tel:data.tel||"",adres:data.adres||"",sureGun:data.sureGun||1,birimFiyat:data.birimFiyat||0,kdv:data.kdv||20,notlar:data.notlar||""});
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const save=()=>{
    if(!form.ad){alert("Firma adı zorunlu!");return;}
    if(isEdit){setFasonFirmalar(p=>p.map(x=>x.id===data.id?{...x,...form}:x));}
    else{setFasonFirmalar(p=>[...p,{id:uid(),...form}]);}
    onClose();
  };
  return(
    <Modal title={isEdit?"Fason Firma Düzenle":"Yeni Fason Firma"} onClose={onClose}>
      <Field label="Firma Adı"><TextInp value={form.ad} onChange={v=>set("ad",v)} placeholder="Boya Atölyesi A"/></Field>
      <Field label="İş Tipi"><TextInp value={form.tip} onChange={v=>set("tip",v)} placeholder="Elektrostatik Boya"/></Field>
      <Field label="Telefon"><TextInp value={form.tel} onChange={v=>set("tel",v)} placeholder="0212 xxx xx xx"/></Field>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
        <Field label="Süre (gün)"><NumInp value={form.sureGun} onChange={v=>set("sureGun",v||1)} style={{width:"100%"}}/></Field>
        <Field label="Birim Fiyat (₺)"><NumInp value={form.birimFiyat} onChange={v=>set("birimFiyat",v||0)} step={0.01} style={{width:"100%"}}/></Field>
        <Field label="KDV %"><NumInp value={form.kdv} onChange={v=>set("kdv",v||0)} style={{width:"100%"}}/></Field>
      </div>
      <Field label="Notlar"><TextInp value={form.notlar} onChange={v=>set("notlar",v)} placeholder="Ek notlar"/></Field>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:6}}>
        <Btn onClick={onClose}>İptal</Btn>
        <Btn variant="primary" color={C.lav} onClick={save}>{isEdit?"Kaydet":"Ekle"}</Btn>
      </div>
    </Modal>
  );
}

// ── MODAL: ÜRÜN ───────────────────────────────────────────────────────────────


// Rekürsif YM detay satırı bileşeni — max 8 seviye derinlik
const MAX_YM_DEPTH = 8;
function YmDetaySatir({b, indent=0, hamMaddeler=[], yarimamulList=[], hizmetlerMerged=[]}){
  if(indent >= MAX_YM_DEPTH) return null;
  const [acik,setAcik] = useState(false);
  const isYM = b.tip==="yarimamul";
  const ymKalem = isYM ? yarimamulList.find(x=>x.id===b.kalemId) : null;
  const tumKalemler = [...hamMaddeler,...yarimamulList,...hizmetlerMerged];
  const icDetay = ymKalem?.bom?.map(b2=>{
    const k2=tumKalemler.find(x=>x.id===b2.kalemId);
    const m2=k2?bomKalemMaliyet(k2,b2.miktar,b2.birim,hamMaddeler,yarimamulList,hizmetlerMerged):0;
    return {...b2,kalem:k2,maliyet:m2};
  })||[];
  const dc = b.tip==="hammadde"?"#3E7BD4":b.tip==="yarimamul"?"#00C2A0":b.kalem?.tip==="fason"?"#7C5CBF":"#E8914A";
  const pl = 16+indent*14;
  return(
    <>
      <div onClick={()=>isYM&&icDetay.length>0&&setAcik(a=>!a)}
        style={{padding:`6px ${pl}px 6px ${pl}px`,display:"flex",justifyContent:"space-between",
        alignItems:"center",borderBottom:"1px solid rgba(255,255,255,.04)",
        cursor:isYM&&icDetay.length>0?"pointer":"default",
        background:acik?"rgba(0,195,160,.04)":"transparent",transition:"background .15s"}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            {isYM&&icDetay.length>0&&(
              <span style={{fontSize:9,color:dc,minWidth:8}}>{acik?"▾":"▸"}</span>
            )}
            <span style={{fontSize:9,background:`${dc}20`,color:dc,borderRadius:3,
              padding:"1px 4px",fontWeight:700,flexShrink:0}}>
              {b.tip==="hammadde"?"HM":b.tip==="yarimamul"?"YM":b.kalem?.tip==="fason"?"FAS":"İÇ"}
            </span>
            <span style={{fontSize:11,color:"#ccc",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              {b.kalem?.ad||"?"}
            </span>
          </div>
          <div style={{fontSize:9,color:"#666",marginTop:1,paddingLeft:isYM&&icDetay.length>0?14:0}}>
            {b.miktar} {b.birim}
            {(b.kalem?.tip==="ic")&&(b.kalem?.sureDkAdet||0)>0&&(()=>{
              const sn=b.kalem.sureDkAdet;
              return sn>=60
                ? <span style={{marginLeft:4}}>· {Math.floor(sn/60)}dk {sn%60>0?sn%60+'sn':''}</span>
                : <span style={{marginLeft:4}}>· {sn} sn</span>;
            })()}
            {isYM&&icDetay.length>0&&<span style={{marginLeft:4,color:dc}}>· {icDetay.length} bileşen</span>}
          </div>
        </div>
        <div style={{fontSize:11,fontWeight:700,color:dc,flexShrink:0}}>{(b.maliyet||0).toFixed(2)}₺</div>
      </div>
      {acik&&icDetay.map((d,di)=>(
        <YmDetaySatir key={di} b={d} indent={indent+1}
          hamMaddeler={hamMaddeler} yarimamulList={yarimamulList} hizmetlerMerged={hizmetlerMerged}/>
      ))}
    </>
  );
}

function OzetGrupKart({baslik,renk,ikon,satirlar,toplam,genelToplam,ymDetayFn,hamMaddeler=[],yarimamulList=[],hizmetlerMerged=[]}){
  const [acik,setAcik]   = useState(true);
  const [acikYM,setAcikYM] = useState({});
  return(
    <div style={{background:"rgba(255,255,255,.025)",border:`1px solid ${renk}25`,
      borderRadius:14,overflow:"hidden",marginBottom:10}}>
      <div onClick={()=>setAcik(a=>!a)}
        style={{background:`${renk}0E`,padding:"10px 16px",display:"flex",
        justifyContent:"space-between",alignItems:"center",
        borderBottom:acik&&satirlar.length>0?`1px solid ${renk}20`:"none",
        cursor:"pointer",userSelect:"none"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:15}}>{ikon}</span>
          <span style={{fontSize:13,fontWeight:700,color:renk,fontFamily:"Montserrat,sans-serif"}}>{baslik}</span>
          <span style={{fontSize:10,color:"#666"}}>{satirlar.length} kalem</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:18,fontWeight:800,color:renk,fontFamily:"Montserrat,sans-serif"}}>{(toplam).toFixed(2)}₺</span>
          <span style={{fontSize:11,color:"#666",transform:acik?"rotate(0)":"rotate(-90deg)",display:"inline-block",transition:"transform .2s"}}>▾</span>
        </div>
      </div>
      {acik&&satirlar.map((b,i)=>{
        const isYM   = b.tip==="yarimamul";
        const detay  = isYM && ymDetayFn ? ymDetayFn(b) : [];
        const ymAcik = acikYM[b.id||i];
        return(
          <div key={b.id||i}>
            <div onClick={()=>isYM&&setAcikYM(p=>({...p,[b.id||i]:!p[b.id||i]}))}
              style={{padding:"9px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",
              borderBottom:`1px solid rgba(255,255,255,.06)`,
              cursor:isYM?"pointer":"default",
              background:ymAcik?`${renk}06`:"transparent",transition:"background .15s"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  {isYM&&<span style={{fontSize:10,color:renk,opacity:.7,minWidth:10}}>{ymAcik?"▾":"▸"}</span>}
                  <div style={{fontSize:12,color:"#e8e8e8",fontWeight:500,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {b.kalem?.ad||"?"}
                  </div>
                </div>
                <div style={{fontSize:10,color:"#888",paddingLeft:isYM?16:0,marginTop:2}}>
                  {b.miktar} {b.birim}
                  {(b.kalem?.tip==="ic"||(b.kalem==null&&hizmetlerMerged.find(h=>h.id===b.kalemId)?.tip==="ic"))&&(()=>{
                    const sn=b.kalem?.sureDkAdet||hizmetlerMerged.find(h=>h.id===b.kalemId)?.sureDkAdet||0;
                    if(!sn) return null;
                    return sn>=60
                      ? <span style={{marginLeft:6}}>· {Math.floor(sn/60)}dk {sn%60>0?sn%60+'sn':''}</span>
                      : <span style={{marginLeft:6}}>· {sn} sn</span>;
                  })()}
                  {isYM&&detay.length>0&&<span style={{marginLeft:6,color:renk}}>· {detay.length} bileşen</span>}
                </div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                <div style={{fontSize:13,fontWeight:700,color:renk}}>{(b.maliyet||0).toFixed(2)}₺</div>
                <div style={{fontSize:9,color:"#666"}}>
                  %{genelToplam>0?((b.maliyet||0)/genelToplam*100).toFixed(1):0}
                </div>
              </div>
            </div>
            {isYM&&ymAcik&&(
              <div style={{background:"rgba(0,0,0,.18)",borderBottom:`1px solid rgba(255,255,255,.06)`}}>
                {detay.length===0?(
                  <div style={{padding:"8px 28px",fontSize:11,color:"#666"}}>Bu yarı mamül için BOM tanımlı değil</div>
                ):detay.map((d,di)=>(
                  <YmDetaySatir key={di} b={d} indent={0}
                    hamMaddeler={hamMaddeler} yarimamulList={yarimamulList} hizmetlerMerged={hizmetlerMerged}/>
                ))}
                <div style={{padding:"5px 16px",display:"flex",justifyContent:"flex-end",fontSize:10,
                  color:"#666",borderTop:"1px solid rgba(255,255,255,.04)"}}>
                  İç toplam: <strong style={{color:renk,marginLeft:4}}>
                    {detay.reduce((s,d)=>s+(d.maliyet||0),0).toFixed(2)}₺
                  </strong>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function InlineEklePanel({tip,hamMaddeler,yarimamulList,hizmetler,onClose,onEkle}){
  const liste=tip==="hammadde"?hamMaddeler:tip==="yarimamul"?yarimamulList:hizmetler;
  const tipCol=tip==="hammadde"?C.sky:tip==="yarimamul"?C.cyan:C.lav;
  const tipLabel=tip==="hammadde"?"Ham Madde":tip==="yarimamul"?"Yarı Mamül":"Hizmet";
  const [kalemId,setKalemId]=useState(liste[0]?.id||"");
  const [miktar,setMiktar]=useState(1);
  const kalem=liste.find(x=>x.id===kalemId);
  const birimOps=kalem?.birimGrup
    ? BIRIM_GRUPLARI[kalem.birimGrup]?.birimler.map(b=>({value:b.id,label:b.label}))||[]
    : [{value:kalem?.birim||"adet",label:kalem?.birim||"adet"}];
  const [birim,setBirim]=useState(birimOps[0]?.value||"adet");
  const maliyet=kalem?bomKalemMaliyet(kalem,miktar,birim,hamMaddeler,yarimamulList,hizmetler):0;
  return(
    <div style={{border:`2px solid ${tipCol}40`,borderRadius:12,padding:"14px",
      background:`${tipCol}07`,marginTop:4}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <span style={{fontSize:12,fontWeight:700,color:tipCol}}>+ {tipLabel} Ekle</span>
        <button onClick={onClose}
          style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:20,lineHeight:1}}>×</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 90px 90px",gap:8}}>
        <Field label="Kalem">
          <select value={kalemId} onChange={e=>{
            setKalemId(e.target.value);
            const k=liste.find(x=>x.id===e.target.value);
            setBirim(k?.birim||"adet");
          }} style={{width:"100%",background:C.s3,border:`1px solid ${C.border}`,
            borderRadius:9,padding:"9px 10px",fontSize:12,color:C.text,cursor:"pointer"}}>
            {liste.map(x=><option key={x.id} value={x.id}>{x.ad}</option>)}
          </select>
        </Field>
        <Field label="Miktar">
          <NumInp value={miktar} onChange={v=>setMiktar(v||1)} step={0.001} style={{width:"100%"}}/>
        </Field>
        <Field label="Birim">
          <select value={birim} onChange={e=>setBirim(e.target.value)}
            style={{width:"100%",background:C.s3,border:`1px solid ${C.border}`,
            borderRadius:9,padding:"9px 10px",fontSize:12,color:C.text}}>
            {birimOps.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
      </div>
      {kalem&&<div style={{fontSize:11,color:C.muted,margin:"6px 0 10px"}}>
        Maliyet: <strong style={{color:tipCol}}>{fmt(maliyet)}₺</strong>
        {kalem.kod&&<span style={{marginLeft:8,opacity:.6}}>{kalem.kod}</span>}
      </div>}
      <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
        <button onClick={onClose}
          style={{background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,
          borderRadius:8,padding:"7px 14px",fontSize:12,color:C.sub,cursor:"pointer"}}>Vazgeç</button>
        <button onClick={()=>{
          if(!kalemId)return;
          onEkle({tip,kalemId,miktar:miktar||1,birim,fireTahmini:0,not:""});
        }} style={{background:`${tipCol}18`,border:`1px solid ${tipCol}40`,
          borderRadius:8,padding:"7px 16px",fontSize:12,fontWeight:700,color:tipCol,cursor:"pointer"}}>
          ✓ BOM'a Ekle
        </button>
      </div>
    </div>
  );
}

function UrunModal({data,onClose,setUrunler,isEdit,hamMaddeler=[],yarimamulList=[],hizmetler:_hizmetler=[]}){
  const hizmetler=_hizmetler; // Gerçek veriler kullanılıyor
  const [form,setForm]=useState({
    kod:     data.kod||"",
    ad:      data.ad||"",
    kategori:data.kategori||"",
    satisKdvDahil: data.satisKdvDahil||0,
    satisKdv:      data.satisKdv||10,
    gelirVergisi:  data.gelirVergisi||30,
    aktif:         data.aktif!==false,
    stok:          data.stok||0,
    minStok:       data.minStok||0,
  });
  const [bom,setBom]       = useState(data.bom||[]);
  const [ekTip,setEkTip]   = useState(null);
  const sf = (k,v) => setForm(p=>({...p,[k]:v}));

  const tumK = [...hamMaddeler,...yarimamulList,...hizmetler];
  const topMal = bom.reduce((s,b)=>{
    const k=tumK.find(x=>x.id===b.kalemId);
    return s+(k?bomKalemMaliyet(k,b.miktar,b.birim,hamMaddeler,yarimamulList,hizmetler):0);
  },0);
  const netSatis = form.satisKdvDahil/(1+(form.satisKdv||0)/100);
  const kar      = netSatis - topMal;
  const marj     = netSatis>0 ? (kar/netSatis)*100 : 0;

  const handleSave = () => {
    if(!form.ad.trim()){alert("Ürün adı zorunlu!");return;}
    const yeniUrun = {...form, bom};
    if(isEdit){
      setUrunler(prev => prev.map(x => x.id===data.id ? {...x,...yeniUrun} : x));
    } else {
      setUrunler(prev => [...prev, {id:uid(), ...yeniUrun}]);
    }
    onClose();
  };

  const handleSil = () => {
    
    setUrunler(prev => prev.filter(x => x.id !== data.id));
    onClose();
  };

  const handleEkle = (b) => {
    setBom(prev => [...prev, {...b, id:uid()}]);
    setEkTip(null);
  };

  const tipRenk = {hammadde:C.sky, yarimamul:C.cyan, hizmet:C.lav};
  const tipEtiket = {hammadde:"HM", yarimamul:"YM", hizmet:"HİZ"};

  return(
    <div className="overlay">
      <div className="modal" style={{maxWidth:680}} onClick={e=>e.stopPropagation()}>

        {/* Başlık */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <h3 style={{fontSize:17,fontWeight:800,color:C.text,fontFamily:F}}>
            {isEdit?"Ürün Düzenle":"Yeni Ürün"}
          </h3>
          <button onClick={onClose} style={{background:"rgba(255,255,255,.06)",border:`1px solid ${C.border}`,
            borderRadius:8,width:30,height:30,cursor:"pointer",color:C.muted,fontSize:16,
            display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
        </div>

        {/* Temel bilgiler */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
          <Field label="Ürün Kodu" style={{marginBottom:0}}>
            <TextInp value={form.kod} onChange={v=>sf("kod",v)} placeholder="TT-002"/>
          </Field>
          <Field label="Kategori" style={{marginBottom:0}}>
            <TextInp value={form.kategori} onChange={v=>sf("kategori",v)} placeholder="Tabure"/>
          </Field>
        </div>
        <Field label="Ürün Adı" style={{marginBottom:10}}>
          <TextInp value={form.ad} onChange={v=>sf("ad",v)} placeholder="Trio Tabure - Hardal"/>
        </Field>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:14}}>
          <Field label="Satış Fiyatı (KDV dahil)" style={{marginBottom:0}}>
            <NumInp value={form.satisKdvDahil} onChange={v=>sf("satisKdvDahil",v||0)} step={1} style={{width:"100%"}}/>
          </Field>
          <Field label="Satış KDV %" style={{marginBottom:0}}>
            <select value={String(form.satisKdv)} onChange={e=>sf("satisKdv",parseInt(e.target.value))}
              style={{width:"100%",background:C.s3,border:`1px solid ${C.border}`,borderRadius:9,
              padding:"9px 10px",fontSize:13,color:C.text,cursor:"pointer"}}>
              {["0","1","8","10","20"].map(v=><option key={v} value={v} style={{background:C.s2}}>%{v}</option>)}
            </select>
          </Field>
          <Field label="Mevcut Stok (adet)" style={{marginBottom:0}}>
            <NumInp value={form.stok} onChange={v=>sf("stok",v||0)} style={{width:"100%"}}/>
          </Field>
          <Field label="Min Stok (adet)" style={{marginBottom:0}}>
            <NumInp value={form.minStok} onChange={v=>sf("minStok",v||0)} style={{width:"100%"}}/>
          </Field>
        </div>

        {/* BOM Başlık */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <span style={{fontSize:11,fontWeight:700,color:C.muted,letterSpacing:1,textTransform:"uppercase"}}>
            📦 Bileşenler (Yarı Mamül + Ham Madde + İşçilik)
          </span>
          <div style={{display:"flex",gap:5}}>
            {[["yarimamul","⚙️ Yarı Mamül",C.cyan],["hammadde","🧱 Ham Madde",C.sky],["hizmet","👷 İşçilik",C.lav]].map(([t,l,c])=>(
              <button key={t} onClick={()=>setEkTip(ekTip===t?null:t)}
                style={{background:ekTip===t?`${c}25`:`${c}0D`,border:`1px solid ${ekTip===t?c:c+"25"}`,
                borderRadius:7,padding:"4px 9px",fontSize:10,fontWeight:600,color:c,cursor:"pointer",
                transition:"all .15s"}}>+ {l}</button>
            ))}
          </div>
        </div>

        {/* Inline Ekle Paneli */}
        {ekTip&&<InlineEklePanel key={ekTip} tip={ekTip}
          hamMaddeler={hamMaddeler} yarimamulList={yarimamulList} hizmetler={hizmetler}
          onClose={()=>setEkTip(null)} onEkle={handleEkle}/>}

        {/* BOM Listesi */}
        {bom.length===0?(
          <div style={{textAlign:"center",padding:"18px",color:C.muted,fontSize:12,
            background:"rgba(255,255,255,.02)",border:`1px dashed ${C.border}`,borderRadius:10,marginBottom:12}}>
            Henüz bileşen yok. Yukarıdan yarı mamül, ham madde veya işçilik ekleyin.
          </div>
        ):(
          <div style={{marginBottom:12,maxHeight:260,overflowY:"auto"}}>
            <div style={{display:"grid",gridTemplateColumns:"20px 34px 1fr 80px 80px 28px",gap:6,
              padding:"2px 8px 6px",opacity:.5}}>
              <span/><span/><span style={{fontSize:9,color:C.muted}}>KALEM</span>
              <span style={{fontSize:9,color:C.muted}}>MİKTAR</span>
              <span style={{fontSize:9,color:C.muted,textAlign:"right"}}>MALİYET</span>
              <span/>
            </div>
            {bom.map((b,i)=>{
              const k=tumK.find(x=>x.id===b.kalemId);
              const mal=k?bomKalemMaliyet(k,b.miktar,b.birim,hamMaddeler,yarimamulList,hizmetler):0;
              const tc=tipRenk[b.tip]||C.muted;
              return(
                <div key={b.id||i}
                  draggable
                  onDragStart={e=>{e.dataTransfer.setData("bomIdx",String(i));e.currentTarget.style.opacity=".4";}}
                  onDragEnd={e=>{e.currentTarget.style.opacity="1";}}
                  onDragOver={e=>e.preventDefault()}
                  onDrop={e=>{
                    e.preventDefault();
                    const from=parseInt(e.dataTransfer.getData("bomIdx"));
                    const to=i;
                    if(from===to) return;
                    setBom(p=>{
                      const a=[...p];
                      const [moved]=a.splice(from,1);
                      a.splice(to,0,moved);
                      return a;
                    });
                  }}
                  style={{display:"grid",gridTemplateColumns:"20px 34px 1fr 80px 80px 28px",gap:6,
                    alignItems:"center",padding:"6px 8px",borderRadius:8,marginBottom:3,
                    background:"rgba(255,255,255,.025)",border:`1px solid ${tc}18`,
                    cursor:"grab",transition:"opacity .15s"}}>
                  {/* Sürükle tutacağı */}
                  <span style={{color:C.muted,fontSize:13,textAlign:"center",opacity:.5,
                    cursor:"grab",userSelect:"none"}}>⠿</span>
                  <span style={{background:`${tc}18`,color:tc,borderRadius:4,padding:"2px 0",
                    fontSize:9,fontWeight:700,textAlign:"center"}}>{tipEtiket[b.tip]||"?"}</span>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:12,color:C.text,fontWeight:500,
                      overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{k?.ad||"?"}</div>
                    <div style={{fontSize:9,color:C.muted}}>{b.birim}</div>
                  </div>
                  <NumInp value={b.miktar} step={0.001} style={{width:"100%"}}
                    onChange={v=>setBom(p=>p.map((r,ri)=>ri===i?{...r,miktar:v||0}:r))}/>
                  <div style={{fontSize:12,fontWeight:700,color:tc,textAlign:"right"}}>{fmt(mal)}₺</div>
                  <button onClick={()=>setBom(p=>p.filter((_,ri)=>ri!==i))}
                    style={{background:`${C.coral}10`,border:`1px solid ${C.coral}20`,borderRadius:6,
                    width:26,height:26,cursor:"pointer",color:C.coral,fontSize:15,display:"flex",
                    alignItems:"center",justifyContent:"center"}}>×</button>
                </div>
              );
            })}
          </div>
        )}

        {/* Canlı Maliyet Özeti */}
        {bom.length>0&&(
          <div style={{background:"rgba(255,255,255,.03)",border:`1px solid ${C.border}`,
            borderRadius:10,padding:"10px 14px",marginBottom:14,
            display:"flex",gap:20,alignItems:"center",flexWrap:"wrap"}}>
            <div><div style={{fontSize:9,color:C.muted,marginBottom:2}}>TOPLAM MALİYET</div>
              <div style={{fontSize:18,fontWeight:800,color:C.coral,fontFamily:F}}>{fmt(topMal)}₺</div></div>
            {form.satisKdvDahil>0&&<>
              <div style={{color:C.border,fontSize:18}}>›</div>
              <div><div style={{fontSize:9,color:C.muted,marginBottom:2}}>NET SATIŞ</div>
                <div style={{fontSize:18,fontWeight:800,color:C.cyan,fontFamily:F}}>{fmt(netSatis)}₺</div></div>
              <div style={{color:C.border,fontSize:18}}>›</div>
              <div><div style={{fontSize:9,color:C.muted,marginBottom:2}}>KÂR</div>
                <div style={{fontSize:18,fontWeight:800,color:kar>=0?C.mint:C.coral,fontFamily:F}}>{fmt(kar)}₺</div></div>
              <div style={{background:marj>20?`${C.mint}15`:marj>10?`${C.gold}15`:`${C.coral}15`,
                border:`1px solid ${marj>20?C.mint:marj>10?C.gold:C.coral}30`,
                borderRadius:8,padding:"6px 12px",marginLeft:"auto"}}>
                <div style={{fontSize:9,color:C.muted,marginBottom:1}}>MARJ</div>
                <div style={{fontSize:16,fontWeight:800,fontFamily:F,
                  color:marj>20?C.mint:marj>10?C.gold:C.coral}}>%{fmt(marj,1)}</div>
              </div>
            </>}
          </div>
        )}

        {/* Aktif toggle */}
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
          <div onClick={()=>sf("aktif",!form.aktif)} style={{width:34,height:19,borderRadius:10,
            cursor:"pointer",background:form.aktif?C.mint:"rgba(255,255,255,.1)",
            position:"relative",transition:"background .2s"}}>
            <div style={{position:"absolute",top:2,left:form.aktif?16:2,width:15,height:15,
              borderRadius:"50%",background:"#fff",transition:"left .2s"}}/>
          </div>
          <span style={{fontSize:12,color:C.sub}}>Aktif ürün</span>
        </div>

        {/* Footer butonlar */}
        <div style={{display:"flex",gap:8,justifyContent:"flex-end",paddingTop:14,
          borderTop:`1px solid ${C.border}`}}>
          {isEdit&&<button onClick={handleSil}
            style={{background:`${C.coral}10`,border:`1px solid ${C.coral}25`,borderRadius:9,
            padding:"9px 16px",fontSize:13,fontWeight:600,color:C.coral,cursor:"pointer",
            marginRight:"auto"}}>🗑 Sil</button>}
          <Btn onClick={onClose}>İptal</Btn>
          <Btn variant="primary" onClick={handleSave}>{isEdit?"Kaydet":"✓ Ürünü Kaydet"}</Btn>
        </div>

      </div>
    </div>
  );
}


// ══ BOM MODALS ════════════════════════════════════════════════════════════════

function BomEditor({bom,onChange,hamMaddeler,yarimamulList,hizmetler,kendisi=""}){
  const [addTip,setAddTip]=useState(null);
  // Inline ekleme state'leri
  const [selId,setSelId]=useState("");
  const [selMiktar,setSelMiktar]=useState(1);
  const [selBirim,setSelBirim]=useState("adet");
  const [selFire,setSelFire]=useState(0);
  const [selNot,setSelNot]=useState("");

  const upd=(id,k,v)=>onChange(bom.map(r=>r.id===id?{...r,[k]:v}:r));
  const del=(id)=>onChange(bom.filter(r=>r.id!==id));

  // Tip değişince ilk kalemi seç
  const handleTipSec=(tip)=>{
    const liste=tip==="hammadde"?hamMaddeler:tip==="yarimamul"?yarimamulList.filter(y=>y.id!==kendisi):hizmetler;
    const ilk=liste[0];
    setSelId(ilk?.id||"");
    setSelBirim(ilk?.birim||"adet");
    setSelMiktar(1);
    setSelFire(0);
    setSelNot("");
    setAddTip(tip);
  };

  const handleEkle=()=>{
    if(!selId) return;
    onChange([...bom,{id:uid(),tip:addTip,kalemId:selId,miktar:selMiktar||1,birim:selBirim,fireTahmini:selFire||0,fireBirim:"%",not:selNot}]);
    setAddTip(null);
  };

  // Sürükle-bırak
  const onDragStart=(e,i)=>{e.dataTransfer.setData("bomIdx",String(i));e.currentTarget.style.opacity=".4";};
  const onDragEnd=(e)=>e.currentTarget.style.opacity="1";
  const onDrop=(e,to)=>{
    e.preventDefault();
    const from=parseInt(e.dataTransfer.getData("bomIdx"));
    if(from===to) return;
    const a=[...bom];const [m]=a.splice(from,1);a.splice(to,0,m);
    onChange(a);
  };

  return(
    <div>
      {/* BOM satırları */}
      {bom.length===0&&!addTip&&(
        <div style={{textAlign:"center",padding:"14px 0",color:C.muted,fontSize:12}}>
          Henüz bileşen eklenmedi. Aşağıdan ekleyin.
        </div>
      )}
      {bom.map((row,ri)=>{
        const tc=row.tip==="hammadde"?C.sky:row.tip==="yarimamul"?C.cyan:C.lav;
        const tl=row.tip==="hammadde"?"HM":row.tip==="yarimamul"?"YM":"HİZ";
        const liste=row.tip==="hammadde"?hamMaddeler:row.tip==="yarimamul"?yarimamulList:hizmetler;
        const kalem=liste.find(x=>x.id===row.kalemId);
        const bgr=BIRIM_GRUPLARI[kalem?.birimGrup];
        const birimOps=bgr?bgr.birimler.map(b=>({value:b.id,label:b.label})):[{value:row.birim||"adet",label:row.birim||"adet"}];
        const satirMaliyet = kalem ? bomKalemMaliyet(kalem, row.miktar||0, row.birim||"adet", hamMaddeler, yarimamulList, hizmetler) : 0;
        const hmBirimAcik = kalem?.birimGrup==="uzunluk"
          ? (kalem.birim==="boy"?`₺/mt (1boy=${boyUzunlukCmDuzelt(kalem.boyUzunluk)}cm)`:`₺/${kalem.birim}`)
          : kalem?`₺/${kalem.birim||"adet"}`:"";
        return(
          <div key={row.id}
            draggable onDragStart={e=>onDragStart(e,ri)} onDragEnd={onDragEnd}
            onDragOver={e=>e.preventDefault()} onDrop={e=>onDrop(e,ri)}
            style={{borderRadius:9,marginBottom:4,background:"rgba(255,255,255,.018)",
              border:`1px solid ${C.border}`,animation:`row-in .2s ${ri*.03}s ease both`,
              overflow:"hidden",cursor:"grab",transition:"opacity .15s"}}>
            <div style={{display:"grid",gridTemplateColumns:"16px 38px 1fr 72px 76px 52px 22px",
              gap:6,alignItems:"center",padding:"7px 8px"}}>
              {/* Tutacak */}
              <span style={{color:C.muted,fontSize:13,textAlign:"center",opacity:.4,userSelect:"none"}}>⠿</span>
              <span style={{background:`${tc}14`,color:tc,border:`1px solid ${tc}22`,borderRadius:6,
                padding:"2px 0",fontSize:9,fontWeight:700,textAlign:"center"}}>{tl}</span>
              <div>
                <div style={{fontSize:12,fontWeight:500,color:C.text,lineHeight:1.3}}>{kalem?.ad||"?"}</div>
                {hmBirimAcik&&<div style={{fontSize:9,color:C.muted,marginTop:1}}>{hmBirimAcik}</div>}
              </div>
              <input type="number" step={0.001} min={0} value={row.miktar??""} className="inp"
                onChange={e=>upd(row.id,"miktar",e.target.value===""?0:parseFloat(e.target.value))}
                style={{background:"rgba(255,255,255,.04)",border:`1px solid ${C.border}`,borderRadius:7,
                  padding:"5px 7px",fontSize:12,color:C.text,textAlign:"right",width:"100%"}}/>
              <select value={row.birim||""} className="inp" onChange={e=>upd(row.id,"birim",e.target.value)}
                style={{background:C.s3,border:`1px solid ${C.border}`,borderRadius:7,
                  padding:"5px 7px",fontSize:11,color:C.text,width:"100%",cursor:"pointer"}}>
                {birimOps.map(o=><option key={o.value} value={o.value} style={{background:C.s2}}>{o.label}</option>)}
              </select>
              <div style={{position:"relative"}}>
                <input type="number" step={0.1} min={0} value={row.fireTahmini??""} className="inp"
                  onChange={e=>upd(row.id,"fireTahmini",e.target.value===""?0:parseFloat(e.target.value))}
                  style={{background:"rgba(255,255,255,.02)",border:`1px solid ${C.border}`,borderRadius:7,
                    padding:"5px 18px 5px 5px",fontSize:10,color:C.gold,textAlign:"right",width:"100%"}}/>
                <span style={{position:"absolute",right:4,top:"50%",transform:"translateY(-50%)",
                  fontSize:7,color:C.muted,pointerEvents:"none"}}>fire</span>
              </div>
              <button onClick={()=>del(row.id)} style={{width:22,height:22,borderRadius:6,
                border:`1px solid ${C.border}`,background:"transparent",color:C.muted,fontSize:13,
                cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s"}}
                onMouseEnter={e=>{e.currentTarget.style.background="rgba(220,60,60,.15)";e.currentTarget.style.color=C.coral;}}
                onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color=C.muted;}}>×</button>
            </div>
            {satirMaliyet>0&&(()=>{
              const kdvOran  = kalem?.kdv||0;
              const listeNet = _netFiyat(kalem?.listeFiyat||kalem?.birimFiyat||0, kalem?.iskonto||0);
              const kdvliNet = listeNet*(1+kdvOran/100);
              const boyUzunlukCm2 = boyUzunlukCmDuzelt(kalem?.boyUzunluk); // 0 ise girilmemiş

              // ── Birim fiyat gösterimi ─────────────────────────────────────
              // ALTIN KURAL: listeFiyat HER ZAMAN TL/mt → kdvliNet = TL/mt
              // birim="boy" sadece stok sayım birimi, fiyat hesabını etkilemez
              const birimFiyatGoster = (()=>{
                if(kalem?.birimGrup!=="uzunluk")
                  return `${fmt(kdvliNet,2)}₺/${kalem?.birim||"adet"}${kdvOran>0?` (KDV%${kdvOran} dahil)`:""}`;
                // mt veya boy: kdvliNet = TL/mt her zaman
                if(kalem.birim==="mt")
                  return `${fmt(kdvliNet,2)}₺/mt${kdvOran>0?` (KDV%${kdvOran} dahil)`:""}`;
                // boy: kdvliNet = TL/mt → sadece ₺/mt göster
                if(kalem.birim==="boy") {
                  return `${fmt(kdvliNet,2)}₺/mt${kdvOran>0?` (KDV%${kdvOran} dahil)`:""}`;
                }
                if(kalem.birim==="cm")
                  return `${fmt(kdvliNet,2)}₺/cm${kdvOran>0?` (KDV%${kdvOran} dahil)`:""}`;
                return `${fmt(kdvliNet,2)}₺/${kalem?.birim||""}`;
              })();

              // ── Miktar dönüşüm gösterimi (128.6cm = 1.286mt gibi) ────────
              const birimAcik = (()=>{
                if(kalem?.birimGrup!=="uzunluk") return "";
                const bm=row.birim, km=kalem?.birim;
                if(bm==="cm"  &&km==="mt")  return ` = ${fmt(row.miktar/100,3)}mt`;
                if(bm==="mm"  &&km==="mt")  return ` = ${fmt(row.miktar/1000,3)}mt`;
                if(bm==="mt"  &&km==="mt")  return ""; // aynı birim
                if(bm==="cm"  &&km==="boy"&&boyUzunlukCm2>0) return ` = ${fmt(row.miktar/boyUzunlukCm2,3)}boy`;
                if(bm==="mt"  &&km==="boy"&&boyUzunlukCm2>0) return ` = ${fmt(row.miktar*100/boyUzunlukCm2,3)}boy`;
                if(bm==="mm"  &&km==="boy"&&boyUzunlukCm2>0) return ` = ${fmt(row.miktar/10/boyUzunlukCm2,3)}boy`;
                if(bm==="boy" &&km==="boy") return ""; // aynı
                return "";
              })();
              return(
                <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:6,
                  padding:"3px 10px 4px",background:"rgba(255,255,255,.01)",borderTop:`1px solid ${C.border}`}}>
                  <span style={{fontSize:9,color:C.muted}}>{row.miktar} {row.birim}{birimAcik} ×</span>
                  <span style={{fontSize:9,color:C.sub}}>{birimFiyatGoster}</span>
                  <span style={{fontSize:9,color:C.muted}}>=</span>
                  <span style={{fontSize:11,fontWeight:700,color:C.mint}}>{fmt(satirMaliyet)}₺</span>
                </div>
              );
            })()}
          </div>
        );
      })}

      {/* ── INLINE EKLEME PANELİ ── */}
      {addTip&&(()=>{
        const tipRnk=addTip==="hammadde"?C.sky:addTip==="yarimamul"?C.cyan:C.lav;
        const tipLbl=addTip==="hammadde"?"Ham Madde":addTip==="yarimamul"?"Yarı Mamül":"Hizmet";
        const liste=addTip==="hammadde"?hamMaddeler:addTip==="yarimamul"?yarimamulList.filter(y=>y.id!==kendisi):hizmetler;
        const secK=liste.find(x=>x.id===selId);
        const bgr=BIRIM_GRUPLARI[secK?.birimGrup];
        const birimOps=bgr?bgr.birimler.map(b=>({value:b.id,label:b.label})):[{value:secK?.birim||"adet",label:secK?.birim||"adet"}];
        const onKalemDeg=(id)=>{
          const k=liste.find(x=>x.id===id);
          setSelId(id);
          setSelBirim(k?.birim||"adet");
        };
        const anlıkMaliyet=secK?bomKalemMaliyet(secK,selMiktar||0,selBirim,hamMaddeler,yarimamulList,hizmetler):0;
        // DEBUG satırı — sorun giderme için


        // Kalemler kategoriye göre grupla
        const katGroups=[...new Set(liste.map(x=>x.kategori||"Diğer"))].sort();
        return(
          <div style={{marginTop:8,background:`${tipRnk}08`,border:`1px solid ${tipRnk}30`,
            borderRadius:10,padding:"10px 12px",animation:"fade-up .2s ease"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <span style={{fontSize:11,fontWeight:700,color:tipRnk}}>+ {tipLbl} Ekle</span>
              <button onClick={()=>setAddTip(null)}
                style={{background:"transparent",border:"none",color:C.muted,fontSize:16,cursor:"pointer",lineHeight:1}}>×</button>
            </div>

            {/* Kalem seçimi — gruplu */}
            <div style={{marginBottom:8}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Kalem</div>
              <select value={selId} onChange={e=>onKalemDeg(e.target.value)}
                style={{width:"100%",background:C.s3,border:`1px solid ${tipRnk}40`,borderRadius:8,
                  padding:"8px 10px",fontSize:12,color:C.text,cursor:"pointer"}}>
                {katGroups.map(kat=>(
                  <optgroup key={kat} label={kat} style={{background:C.s2}}>
                    {liste.filter(x=>(x.kategori||"Diğer")===kat).map(x=>(
                      <option key={x.id} value={x.id} style={{background:C.s2}}>
                        {x.kod?`[${x.kod}] `:""}{x.ad}
                        {x.birimFiyat>0?` — ${fmt(x.birimFiyat*(1+(x.kdv||0)/100))}₺/${x.birim||"adet"}`:""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Miktar + Birim yan yana */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
              <div>
                <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Miktar</div>
                <input type="number" step={0.001} min={0} value={selMiktar} className="inp"
                  onChange={e=>setSelMiktar(parseFloat(e.target.value)||0)}
                  style={{width:"100%",background:"rgba(255,255,255,.04)",border:`1px solid ${tipRnk}40`,
                    borderRadius:8,padding:"7px 10px",fontSize:13,color:C.text,textAlign:"right"}}/>
              </div>
              <div>
                <div style={{fontSize:10,color:C.muted,marginBottom:4}}>Birim</div>
                <select value={selBirim} onChange={e=>setSelBirim(e.target.value)}
                  style={{width:"100%",background:C.s3,border:`1px solid ${tipRnk}40`,borderRadius:8,
                    padding:"7px 10px",fontSize:12,color:C.text,cursor:"pointer"}}>
                  {birimOps.map(o=><option key={o.value} value={o.value} style={{background:C.s2}}>{o.label}</option>)}
                </select>
              </div>
            </div>

            {/* Anlık maliyet göster */}
            {anlıkMaliyet>0&&(
              <div style={{marginBottom:8,padding:"5px 10px",background:"rgba(255,255,255,.03)",
                borderRadius:7,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:4}}>
                <span style={{fontSize:10,color:C.muted}}>
                  {selMiktar} {selBirim}
                  {secK?.birimGrup==="uzunluk"&&(()=>{
                    const boy=boyUzunlukCmDuzelt(secK.boyUzunluk);
                    if(secK.birim==="mt"&&selBirim==="cm") return ` = ${fmt(selMiktar/100,3)}mt`;
                    if(secK.birim==="boy"&&boy>0&&selBirim==="cm") return ` = ${fmt(selMiktar/boy,3)}boy`;
                    if(secK.birim==="boy"&&boy>0&&selBirim==="mt") return ` = ${fmt(selMiktar*100/boy,3)}boy`;
                    return "";
                  })()}
                </span>
                <span style={{fontSize:13,fontWeight:700,color:tipRnk}}>{fmt(anlıkMaliyet)}₺</span>
              </div>
            )}

            {/* Butonlar */}
            <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
              <button onClick={()=>setAddTip(null)}
                style={{background:"transparent",border:`1px solid ${C.border}`,borderRadius:7,
                  padding:"5px 12px",fontSize:12,color:C.muted,cursor:"pointer"}}>İptal</button>
              <button onClick={handleEkle} disabled={!selId}
                style={{background:`${tipRnk}18`,border:`1px solid ${tipRnk}40`,borderRadius:7,
                  padding:"5px 14px",fontSize:12,fontWeight:700,color:tipRnk,cursor:selId?"pointer":"default",
                  opacity:selId?1:.5}}>✓ BOM'a Ekle</button>
            </div>
          </div>
        );
      })()}

      {/* Ekleme butonları */}
      {!addTip&&(
        <div style={{display:"flex",gap:6,marginTop:8}}>
          {[["hammadde","+ Ham Madde",C.sky],["yarimamul","+ Yarı Mamül",C.cyan],["hizmet","+ İşçilik / Fason",C.lav]].map(([tip,lbl,col])=>(
            <button key={tip} onClick={()=>handleTipSec(tip)}
              style={{background:`${col}0D`,border:`1px solid ${col}22`,
              borderRadius:7,padding:"5px 10px",fontSize:11,fontWeight:600,color:col,cursor:"pointer"}}>{lbl}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PROFİL SİHİRBAZI ─────────────────────────────────────────────────────────
// Yücel fiyat listesinden 4 adımda profil/boru seçimi
function ProfilSihirbazi({ onSec, onClose }) {
  const [aCins,   setACins]   = useState("Tümü");
  const [aMat,    setAMat]    = useState("Tümü");
  const [aEbat,   setAEbat]   = useState(null);   // {cat,mat,ebat}
  const [aKal,    setAKal]    = useState(null);
  const [arama,   setArama]   = useState("");
  const [iskonto, setIskonto] = useState(0);

  const CINSE = ["Tümü", ...YUCEL_CATS];

  const malzemeler = useMemo(() => {
    const s = new Set();
    const cins = aCins === "Tümü" ? YUCEL_CATS : [aCins];
    cins.forEach(c => Object.keys(YUCEL_DATA[c] || {}).forEach(m => s.add(m)));
    return ["Tümü", ...s];
  }, [aCins]);

  const ebatlar = useMemo(() => {
    let list = [];
    const cins = aCins === "Tümü" ? YUCEL_CATS : [aCins];
    cins.forEach(c => {
      const mats = aMat === "Tümü" ? Object.keys(YUCEL_DATA[c] || {}) : [aMat];
      mats.forEach(m => {
        if (YUCEL_DATA[c]?.[m]) {
          Object.keys(YUCEL_DATA[c][m]).forEach(e => list.push({ cat: c, mat: m, ebat: e }));
        }
      });
    });
    if (arama) {
      const t = arama.toLowerCase();
      list = list.filter(x => x.ebat.toLowerCase().includes(t));
    }
    return list;
  }, [aCins, aMat, arama]);

  const kalinliklar = useMemo(() => {
    if (!aEbat) return [];
    return Object.keys(YUCEL_DATA[aEbat.cat]?.[aEbat.mat]?.[aEbat.ebat] || {})
      .sort((a,b) => parseFloat(a) - parseFloat(b));
  }, [aEbat]);

  const listeFiyat = aEbat && aKal
    ? YUCEL_DATA[aEbat.cat][aEbat.mat][aEbat.ebat][aKal]
    : null;
  const netF = listeFiyat ? netFiyat(listeFiyat, iskonto) : null;

  const handleSec = () => {
    if (!aEbat || !aKal || !listeFiyat) return;
    onSec({
      ad:       `${aEbat.cat} ${aEbat.mat} ${aEbat.ebat} – ${aKal}mm`,
      kategori: aEbat.cat,
      birimGrup:"uzunluk",
      birim:    "mt",
      listeFiyat: listeFiyat,
      iskonto:  0,
      kdv:      20,
      tedarikci:"Yücel Metal",
      _yucel:   { cat: aEbat.cat, mat: aEbat.mat, ebat: aEbat.ebat, kal: aKal }
    });
  };

  const tab = (label, active, onClick, col=C.cyan) => (
    <button onClick={onClick} style={{
      padding:"6px 12px", borderRadius:8, border:`1px solid ${active?col+"60":C.border}`,
      background: active ? `${col}12` : "rgba(255,255,255,.02)",
      color: active ? col : C.muted, fontSize:12, fontWeight: active?600:400,
      cursor:"pointer", fontFamily:FB, transition:"all .15s", whiteSpace:"nowrap"
    }}>{label}</button>
  );

  return (
    <div style={{background:C.s2, border:`1px solid ${C.border}`, borderRadius:14, overflow:"hidden"}}>
      {/* Başlık */}
      <div style={{padding:"12px 16px", borderBottom:`1px solid ${C.border}`,
        display:"flex", justifyContent:"space-between", alignItems:"center",
        background:"rgba(232,145,74,.05)"}}>
        <div style={{fontSize:13, fontWeight:700, color:C.cyan}}>🔩 Yücel Fiyat Listesi</div>
        {onClose && <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",color:C.muted,fontSize:16}}>×</button>}
      </div>
      <div style={{padding:"14px 16px"}}>

        {/* Adım 1 – Cins */}
        <div style={{marginBottom:12}}>
          <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:.8,marginBottom:6}}>1 · ÜRÜN CİNSİ</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {CINSE.map(c => tab(c, aCins===c, ()=>{setACins(c);setAMat("Tümü");setAEbat(null);setAKal(null);}))}
          </div>
        </div>

        {/* Adım 2 – Malzeme */}
        <div style={{marginBottom:12}}>
          <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:.8,marginBottom:6}}>2 · MALZEME CİNSİ</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {malzemeler.map(m => tab(m, aMat===m, ()=>{setAMat(m);setAEbat(null);setAKal(null);}, C.sky))}
          </div>
        </div>

        {/* Adım 3 – Ebat Arama */}
        <div style={{marginBottom:12}}>
          <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:.8,marginBottom:6}}>3 · EBAT SEÇİMİ</div>
          <div style={{position:"relative",marginBottom:6}}>
            <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:12,color:C.muted}}>🔍</span>
            <input value={arama} onChange={e=>setArama(e.target.value)} placeholder="Ebat ara... (örn: 15x30)"
              className="inp" style={{width:"100%",paddingLeft:30,background:"rgba(255,255,255,.04)",
                border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 12px 7px 28px",
                fontSize:12,color:C.text,boxSizing:"border-box"}}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(110px,1fr))",gap:4,
            maxHeight:150,overflowY:"auto",background:"rgba(255,255,255,.02)",borderRadius:9,padding:6,
            border:`1px solid ${C.border}`}}>
            {ebatlar.map((obj,i) => {
              const sel = aEbat && aEbat.cat===obj.cat && aEbat.mat===obj.mat && aEbat.ebat===obj.ebat;
              return(
                <button key={i} onClick={()=>{setAEbat(obj);setAKal(null);}} style={{
                  padding:"5px 8px",borderRadius:7,border:`1px solid ${sel?C.mint+"60":C.border}`,
                  background:sel?`${C.mint}10`:"rgba(255,255,255,.02)",
                  color:sel?C.mint:C.sub,fontSize:11,fontWeight:sel?700:400,
                  cursor:"pointer",textAlign:"left",transition:"all .12s"}}>
                  <div style={{fontWeight:600,lineHeight:1.2}}>{obj.ebat}</div>
                  {(aCins==="Tümü"||aMat==="Tümü")&&
                    <div style={{fontSize:9,color:sel?C.mint:C.muted,marginTop:1}}>{obj.cat}·{obj.mat}</div>}
                </button>
              );
            })}
            {ebatlar.length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",padding:"12px 0",fontSize:11,color:C.muted}}>Sonuç yok</div>}
          </div>
        </div>

        {/* Adım 4 – Et Kalınlığı */}
        <div style={{marginBottom:12, opacity: aEbat ? 1 : 0.35, pointerEvents: aEbat ? "auto" : "none"}}>
          <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:.8,marginBottom:6}}>4 · ET KALINLIĞI (mm)</div>
          {!aEbat
            ? <div style={{fontSize:11,color:C.muted}}>Önce ebat seçin</div>
            : <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                {kalinliklar.map(k => tab(`${k} mm`, aKal===k, ()=>setAKal(k), C.gold))}
              </div>}
        </div>

        {/* Fiyat özeti */}
        {listeFiyat && (
          <div style={{background:`${C.s3}`,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{flex:1}}>
                <div style={{fontSize:10,color:C.muted,marginBottom:3}}>Liste Fiyat (₺/mt · KDV hariç)</div>
                <div style={{fontSize:22,fontWeight:800,color:C.cyan,fontFamily:F}}>{fmt(listeFiyat)}₺</div>
              </div>
              <div style={{fontSize:10,color:C.muted,textAlign:"right"}}>İskonto ve KDV bilgisini<br/>ham madde formunda gireceksiniz</div>
            </div>
          </div>
        )}

        {/* Ekle butonu */}
        <button onClick={handleSec} disabled={!listeFiyat} style={{
          width:"100%",padding:"10px",borderRadius:10,border:"none",cursor: listeFiyat?"pointer":"not-allowed",
          background: listeFiyat ? `linear-gradient(135deg,${C.cyan},${C.gold})` : "rgba(255,255,255,.06)",
          color: listeFiyat ? "#0C0800" : C.muted, fontWeight:700, fontSize:13, fontFamily:FB,
          transition:"all .2s", opacity: listeFiyat ? 1 : 0.5}}>
          {listeFiyat ? `✓ Ekle — ${fmt(listeFiyat)}₺/mt` : "Tüm adımları tamamlayın"}
        </button>
      </div>
    </div>
  );
}

// Kayıtlı standart kataloglar — ilerde buraya kumaş, sünger vs. eklenecek
const STANDART_KATALOGLAR = [
  { id:"metal", label:"Metal Profil & Boru", icon:"🔩", desc:"Yücel fiyat listesi — Profil, Boru, Oval Profil", renk:"#3E7BD4", tip:"yucel" },
];

function HamMaddeModal({kalem,onClose,onSave,onDelete,onKopya,hamMaddeler=[],yarimamulList=[],hizmetler=[]}){
  const isEdit=!!kalem?.id;
  const [adim,setAdim]=useState((isEdit||kalem?._kopya)?"form":"kategori-sec");
  // Modal açılınca _kdvDahilInput'u sıfırla — net her zaman hesaplansın
  const [f,setF]=useState(kalem ? {...kalem, _kdvDahilInput:undefined} : {kod:"",ad:"",kategori:"",birimGrup:"uzunluk",birim:"mt",boyUzunluk:null,miktar:0,minStok:0,listeFiyat:0,iskonto:0,kdv:20,tedarikci:"",notlar:"",
    // ── YENİ: Tedarik & Sevkiyat ──
    sevkiyatYontemi:"tedarikci_getirir", tahminiTeslimGun:null, minSiparisMiktar:null, odemeVadesi:null,
    // ── YENİ: Fason Yönlendirme ──
    fasona_gider_mi:false, fasonHedefId:null,
    // ── YENİ: Nakliye Bilgileri ──
    nakliye:{varsayilanNakliyeci:"",nakliyeTel:"",ortalamaUcret:0,ortalamaYuk:0}
  });
  const [tedarikAcik,setTedarikAcik]=useState(!!(kalem?.sevkiyatYontemi&&kalem.sevkiyatYontemi!=="tedarikci_getirir")||!!(kalem?.fasona_gider_mi)||!!(kalem?.nakliye?.varsayilanNakliyeci));
  const up=(k,v)=>setF(p=>({...p,[k]:v}));
  // KURAL: listeFiyat HER ZAMAN TL/mt
  // birim="boy" → stok birimi, fiyat TL/mt cinsinden girilir
  const listeNetHm   = _netFiyat(f.listeFiyat||0, f.iskonto||0); // TL/mt KDV hariç
  const listeKdvliHm = listeNetHm * (1 + (f.kdv||0)/100);       // TL/mt KDV dahil
  const boyUzunlukHm = boyUzunlukCmDuzelt(f.boyUzunluk);
  // net: her zaman TL/mt (gösterim için)
  const net = f.birim==="cm"
    ? listeKdvliHm * 100   // TL/cm → TL/mt
    : listeKdvliHm;        // TL/mt (mt veya boy)
  const secilenGrup=BIRIM_GRUPLARI[f.birimGrup];
  const handleSihirbazSec=(secim)=>{
    setF(p=>({...p,ad:secim.ad,kategori:secim.kategori,birimGrup:secim.birimGrup,birim:secim.birim,
      listeFiyat:secim.listeFiyat,iskonto:secim.iskonto,kdv:secim.kdv,tedarikci:secim.tedarikci,_yucel:secim._yucel}));
    setAdim("form");
  };
  const modalW=adim==="yucel-sihirbaz"?640:adim==="kategori-sec"?520:600;
  const geriBtn=(hedef)=>(
    <button onClick={()=>setAdim(hedef)} style={{background:"transparent",border:"none",cursor:"pointer",
      color:C.muted,fontSize:12,marginBottom:12,padding:0,display:"flex",alignItems:"center",gap:4}}>
      ← Geri
    </button>
  );
  const title=isEdit?"Ham Madde Düzenle":f._kopya?"Ham Madde Kopyası":adim==="kategori-sec"?"Ham Madde Ekle":adim==="yucel-sihirbaz"?"🔩 Metal Profil & Boru Seç":"Ham Madde Ekle";

  return(
    <Modal title={title} onClose={onClose} width={modalW}>

      {/* ── ADIM 1: KATEGORİ SEÇ ── */}
      {adim==="kategori-sec"&&(
        <div>
          <p style={{fontSize:12,color:C.muted,marginBottom:16}}>Nasıl eklemek istiyorsunuz?</p>
          <div style={{marginBottom:10}}>
            <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>📚 Standart Kataloglar</div>
            {STANDART_KATALOGLAR.map(k=>(
              <button key={k.id} onClick={()=>setAdim(k.tip==="yucel"?"yucel-sihirbaz":"form")}
                style={{display:"flex",alignItems:"center",gap:14,padding:"13px 16px",marginBottom:7,
                  background:`${k.renk}08`,border:`1px solid ${k.renk}30`,
                  borderRadius:12,cursor:"pointer",textAlign:"left",transition:"all .18s",width:"100%"}}
                onMouseEnter={e=>{e.currentTarget.style.background=`${k.renk}14`;e.currentTarget.style.borderColor=`${k.renk}55`;}}
                onMouseLeave={e=>{e.currentTarget.style.background=`${k.renk}08`;e.currentTarget.style.borderColor=`${k.renk}30`;}}>
                <div style={{width:44,height:44,borderRadius:11,background:`${k.renk}18`,border:`1px solid ${k.renk}28`,
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{k.icon}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:C.text,fontFamily:F}}>{k.label}</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:2}}>{k.desc}</div>
                </div>
                <div style={{fontSize:18,color:k.renk,opacity:.6}}>→</div>
              </button>
            ))}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
            <div style={{flex:1,height:1,background:C.border}}/>
            <div style={{fontSize:10,color:C.muted}}>veya</div>
            <div style={{flex:1,height:1,background:C.border}}/>
          </div>
          <button onClick={()=>setAdim("form")}
            style={{display:"flex",alignItems:"center",gap:14,padding:"12px 16px",width:"100%",
              background:"rgba(255,255,255,.03)",border:`1px solid ${C.border}`,
              borderRadius:12,cursor:"pointer",textAlign:"left",transition:"all .18s"}}
            onMouseEnter={e=>{e.currentTarget.style.background="rgba(255,255,255,.06)";e.currentTarget.style.borderColor=C.borderHi;}}
            onMouseLeave={e=>{e.currentTarget.style.background="rgba(255,255,255,.03)";e.currentTarget.style.borderColor=C.border;}}>
            <div style={{width:44,height:44,borderRadius:11,background:"rgba(255,255,255,.05)",
              border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>✏️</div>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:600,color:C.text}}>Manuel Giriş</div>
              <div style={{fontSize:11,color:C.muted,marginTop:2}}>Kumaş, sünger, aksesuar veya herhangi bir malzeme</div>
            </div>
            <div style={{fontSize:18,color:C.muted,opacity:.4}}>→</div>
          </button>
        </div>
      )}

      {/* ── ADIM 2a: YÜCEL SİHİRBAZI ── */}
      {adim==="yucel-sihirbaz"&&(
        <div>
          {geriBtn("kategori-sec")}
          <ProfilSihirbazi onSec={handleSihirbazSec}/>
          <div style={{marginTop:8,textAlign:"center"}}>
            <button onClick={()=>setAdim("form")} style={{background:"none",border:"none",cursor:"pointer",
              color:C.muted,fontSize:11,textDecoration:"underline"}}>Listede yok, manuel girmek istiyorum</button>
          </div>
        </div>
      )}

      {/* ── FORM (yeni veya düzenleme) ── */}
      {adim==="form"&&(
        <>
          {!isEdit&&geriBtn("kategori-sec")}

          {f._yucel&&(
            <div style={{background:"rgba(62,123,212,.08)",border:"1px solid rgba(62,123,212,.25)",borderRadius:10,
              padding:"9px 13px",marginBottom:14,display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:15}}>🔩</span>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:600,color:C.text}}>{f.ad}</div>
                <div style={{fontSize:10,color:C.muted}}>Yücel listesinden seçildi</div>
              </div>
              <button onClick={()=>setAdim("yucel-sihirbaz")}
                style={{background:"rgba(62,123,212,.14)",border:"1px solid rgba(62,123,212,.28)",borderRadius:7,
                  padding:"4px 10px",fontSize:10,color:"#3E7BD4",cursor:"pointer",whiteSpace:"nowrap"}}>Değiştir</button>
            </div>
          )}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Field label="Kod"><TextInp value={f.kod} onChange={v=>up("kod",v)} placeholder="PM-001"/></Field>
            <Field label="Kategori">
              <div style={{position:"relative"}}>
                <input value={f.kategori} onChange={e=>up("kategori",e.target.value)}
                  list="hm-kat-list" placeholder="Profil, Kumaş, Aksesuar..."
                  className="inp" style={{width:"100%",background:"rgba(255,255,255,.04)",
                  border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 12px",fontSize:13,color:C.text}}/>
                <datalist id="hm-kat-list">
                  {[...new Set([...hamMaddeler.map(x=>x.kategori),...yarimamulList.map(x=>x.kategori)].filter(Boolean))].map(k=>(
                    <option key={k} value={k}/>
                  ))}
                </datalist>
              </div>
            </Field>
          </div>
          <Field label="Kalem Adı"><TextInp value={f.ad} onChange={v=>up("ad",v)} placeholder="Düz Oval Profil 20x40"/></Field>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Field label="Birim Grubu">
              <select value={f.birimGrup} onChange={e=>{up("birimGrup",e.target.value);up("birim",BIRIM_GRUPLARI[e.target.value]?.birimler[0]?.id||"adet");}}
                style={{width:"100%",background:C.s3,border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 12px",fontSize:13,color:C.text,cursor:"pointer"}}>
                {Object.entries(BIRIM_GRUPLARI).map(([k,g])=><option key={k} value={k} style={{background:C.s2}}>{g.label}</option>)}
              </select>
            </Field>
            <Field label="Birim">
              <select value={f.birim} onChange={e=>{
                const eskiBirim = f.birim;
                const yeniBirim = e.target.value;
                up("birim", yeniBirim);
                // listeFiyat HER ZAMAN TL/mt — birim değişince fiyat değişmez
                // (cm↔mt hariç: cm birimiyle çalışan istisnai durumlar)
                if(f.birimGrup==="uzunluk" && f.listeFiyat>0) {
                  if(eskiBirim==="cm" && yeniBirim==="mt") {
                    up("listeFiyat", Math.round(f.listeFiyat * 100 * 10000)/10000);
                  } else if(eskiBirim==="mt" && yeniBirim==="cm") {
                    up("listeFiyat", Math.round(f.listeFiyat / 100 * 10000)/10000);
                  }
                  // mt↔boy: fiyat değişmez (her zaman TL/mt)
                }
                up("_kdvDahilInput", undefined);
              }}
                style={{width:"100%",background:C.s3,border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 12px",fontSize:13,color:C.text,cursor:"pointer"}}>
                {(secilenGrup?.birimler||[]).map(b=><option key={b.id} value={b.id} style={{background:C.s2}}>{b.label}</option>)}
              </select>
            </Field>
          </div>
          {f.birim==="boy"&&<Field label="Boy Uzunluğu (cm)"><NumInp value={f.boyUzunluk} onChange={v=>{up("boyUzunluk",v);up("_kdvDahilInput",undefined);}} step={1} width={140}/></Field>}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
            <Field label="Mevcut Miktar"><NumInp value={f.miktar} onChange={v=>up("miktar",v)} step={0.01} style={{width:"100%"}}/></Field>
            <Field label="Min Stok"><NumInp value={f.minStok} onChange={v=>up("minStok",v)} step={0.01} style={{width:"100%"}}/></Field>
            <Field label="KDV %">
              <select value={String(f.kdv)} onChange={e=>{
                const kdv=parseInt(e.target.value);
                up("kdv",kdv);
                up("_kdvDahilInput",undefined);
              }} style={{width:"100%",background:C.s3,border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 12px",fontSize:13,color:C.text,cursor:"pointer"}}>
                {["0","10","20"].map(v=><option key={v} value={v} style={{background:C.s2}}>%{v}</option>)}
              </select>
            </Field>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
            <Field label={`Liste Fiyat (₺/mt · KDV hariç)${f.birim==="boy"&&boyUzunlukHm>0?" · 1 boy="+boyUzunlukHm+"cm":""}`}>
              <div style={{display:"flex",gap:5}}>
                <NumInp value={f.listeFiyat} onChange={v=>{
                  const liste=parseFloat(v)||0;
                  up("listeFiyat",liste);
                  up("_kdvDahilInput",undefined); // net otomatik hesaplansın
                }} step={0.01} style={{flex:1}}/>
                {f._yucel&&(
                  <button title="Yücel listesinden güncel fiyatı getir" onClick={()=>{
                    try {
                      const y=f._yucel;
                      const ebatData=YUCEL_DATA[y.cat]?.[y.mat]?.[y.ebat];
                      if(ebatData&&ebatData[y.kal]){
                        const liste=ebatData[y.kal];
                        up("listeFiyat",liste);
                          up("_kdvDahilInput",undefined);
                      }
                    } catch(e){}
                  }} style={{background:"rgba(62,123,212,.15)",border:"1px solid rgba(62,123,212,.3)",
                    borderRadius:8,padding:"0 10px",cursor:"pointer",color:"#3E7BD4",fontSize:14,
                    display:"flex",alignItems:"center",flexShrink:0}}>
                    🔄
                  </button>
                )}
              </div>
            </Field>
            <Field label="İskonto %"><NumInp value={f.iskonto} onChange={v=>{
              up("iskonto",v);
              up("_kdvDahilInput",undefined);
            }} step={1} max={100} style={{width:"100%"}}/></Field>
            <Field label="Net Fiyat (₺/mt · KDV dahil)">
              <input type="number" step="0.0001"
                value={f._kdvDahilInput !== undefined ? f._kdvDahilInput : net || ""}
                onChange={e=>{
                  const v=e.target.value;
                  up("_kdvDahilInput",v);
                  const kdvliMt=parseFloat(v)||0;
                  if(kdvliMt>0){
                    const carpan=(1-(f.iskonto||0)/100)*(1+(f.kdv||0)/100);
                    up("listeFiyat", Math.round(kdvliMt/carpan*10000)/10000);
                  } else { up("listeFiyat",0); }
                }}
                onFocus={e=>e.target.select()}
                placeholder="KDV dahil metre fiyatı"
                style={{width:"100%",background:"rgba(232,145,74,.13)",border:"1px solid rgba(232,145,74,.35)",
                  borderRadius:9,padding:"9px 12px",fontSize:14,fontWeight:700,color:C.cyan,
                  outline:"none",boxSizing:"border-box"}}/>
            </Field>
          </div>
          <Field label="Tedarikçi"><TextInp value={f.tedarikci} onChange={v=>up("tedarikci",v)} placeholder="Firma adı"/></Field>

          {/* ── TEDARİK & SEVKİYAT BİLGİLERİ (Progressive Disclosure) ── */}
          <div style={{marginTop:6,marginBottom:6}}>
            <button onClick={()=>setTedarikAcik(p=>!p)}
              style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"10px 14px",
                background:tedarikAcik?"rgba(62,123,212,.06)":"rgba(255,255,255,.02)",
                border:`1px solid ${tedarikAcik?"rgba(62,123,212,.25)":C.border}`,
                borderRadius:11,cursor:"pointer",transition:"all .2s"}}>
              <span style={{fontSize:14,transition:"transform .2s",transform:tedarikAcik?"rotate(90deg)":"rotate(0)"}}>{tedarikAcik?"▾":"▸"}</span>
              <span style={{fontSize:12,fontWeight:700,color:tedarikAcik?C.sky:C.sub,letterSpacing:.3}}>🚚 Tedarik & Sevkiyat Bilgileri</span>
              {(f.sevkiyatYontemi&&f.sevkiyatYontemi!=="tedarikci_getirir"||f.fasona_gider_mi||f.nakliye?.varsayilanNakliyeci)&&!tedarikAcik&&(
                <span style={{fontSize:9,background:`${C.sky}15`,color:C.sky,borderRadius:5,padding:"2px 7px",marginLeft:"auto"}}>Doldurulmuş</span>
              )}
            </button>

            {tedarikAcik&&(
              <div style={{background:"rgba(255,255,255,.015)",border:`1px solid ${C.border}`,borderTop:"none",
                borderRadius:"0 0 11px 11px",padding:"14px",display:"grid",gap:12}}>

                {/* Sevkiyat Yöntemi */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <Field label="Sevkiyat Yöntemi">
                    <select value={f.sevkiyatYontemi||"tedarikci_getirir"} onChange={e=>up("sevkiyatYontemi",e.target.value)}
                      style={{width:"100%",background:C.s3,border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 12px",fontSize:13,color:C.text,cursor:"pointer"}}>
                      <option value="tedarikci_getirir" style={{background:C.s2}}>🏪 Tedarikçi getiriyor</option>
                      <option value="ben_alirim" style={{background:C.s2}}>🏃 Ben alıyorum</option>
                      <option value="nakliye" style={{background:C.s2}}>🚚 Nakliye ayarlıyorum</option>
                      <option value="kargo" style={{background:C.s2}}>📦 Kargo ile geliyor</option>
                    </select>
                  </Field>
                  <Field label="Tahmini Teslim (gün)">
                    <NumInp value={f.tahminiTeslimGun} onChange={v=>up("tahminiTeslimGun",v)} step={1} placeholder="3" style={{width:"100%"}}/>
                  </Field>
                </div>

                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <Field label="Min Sipariş Miktarı (opsiyonel)">
                    <NumInp value={f.minSiparisMiktar} onChange={v=>up("minSiparisMiktar",v)} step={1} placeholder="—" style={{width:"100%"}}/>
                  </Field>
                  <Field label="Ödeme Vadesi (gün, opsiyonel)">
                    <NumInp value={f.odemeVadesi} onChange={v=>up("odemeVadesi",v)} step={1} placeholder="30" style={{width:"100%"}}/>
                  </Field>
                </div>

                {/* Fason Yönlendirme */}
                <div style={{background:f.fasona_gider_mi?"rgba(124,92,191,.06)":"rgba(255,255,255,.01)",
                  border:`1px solid ${f.fasona_gider_mi?"rgba(124,92,191,.25)":C.border}`,borderRadius:10,padding:"10px 13px"}}>
                  <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",marginBottom:f.fasona_gider_mi?10:0}}>
                    <input type="checkbox" checked={!!f.fasona_gider_mi} onChange={e=>{
                      up("fasona_gider_mi",e.target.checked);
                      if(!e.target.checked) up("fasonHedefId",null);
                    }} style={{accentColor:C.lav,width:15,height:15}}/>
                    <span style={{fontSize:12,fontWeight:600,color:f.fasona_gider_mi?C.lav:C.sub}}>
                      🏭 Bu malzeme alındıktan sonra fasona gidecek
                    </span>
                  </label>
                  {f.fasona_gider_mi&&(
                    <div>
                      <Field label="Fason Firma / Hizmet">
                        <select value={f.fasonHedefId||""} onChange={e=>up("fasonHedefId",e.target.value||null)}
                          style={{width:"100%",background:C.s3,border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 12px",fontSize:13,color:C.text,cursor:"pointer"}}>
                          <option value="" style={{background:C.s2}}>— Seçiniz —</option>
                          {hizmetler.filter(h=>h.tip==="fason").map(h=>(
                            <option key={h.id} value={h.id} style={{background:C.s2}}>{h.ad} — {h.tip2||h.firma||""}</option>
                          ))}
                        </select>
                      </Field>
                      {f.fasonHedefId&&(()=>{
                        const fh=hizmetler.find(h=>h.id===f.fasonHedefId);
                        return fh?(
                          <div style={{display:"flex",gap:8,marginTop:6,flexWrap:"wrap"}}>
                            {fh.firma&&<span style={{fontSize:10,background:`${C.lav}12`,color:C.lav,borderRadius:5,padding:"2px 8px"}}>🏭 {fh.firma}</span>}
                            {fh.sureGun&&<span style={{fontSize:10,background:`${C.gold}12`,color:C.gold,borderRadius:5,padding:"2px 8px"}}>⏱ ~{fh.sureGun} gün</span>}
                            {fh.birimFiyat>0&&<span style={{fontSize:10,background:`${C.cyan}12`,color:C.cyan,borderRadius:5,padding:"2px 8px"}}>💰 {fh.birimFiyat}₺/adet</span>}
                          </div>
                        ):null;
                      })()}
                    </div>
                  )}
                </div>

                {/* Nakliye Bilgisi (sevkiyat=nakliye ise göster) */}
                {f.sevkiyatYontemi==="nakliye"&&(
                  <div style={{background:"rgba(232,145,74,.04)",border:"1px solid rgba(232,145,74,.18)",borderRadius:10,padding:"10px 13px"}}>
                    <div style={{fontSize:10,fontWeight:700,color:"#E8914A",letterSpacing:.5,textTransform:"uppercase",marginBottom:8}}>
                      🚚 Nakliye Bilgisi
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      <Field label="Varsayılan Nakliyeci">
                        <TextInp value={f.nakliye?.varsayilanNakliyeci||""} onChange={v=>up("nakliye",{...f.nakliye,varsayilanNakliyeci:v})} placeholder="Ahmet Nakliyat"/>
                      </Field>
                      <Field label="Nakliye Tel">
                        <TextInp value={f.nakliye?.nakliyeTel||""} onChange={v=>up("nakliye",{...f.nakliye,nakliyeTel:v})} placeholder="0532 xxx xx xx"/>
                      </Field>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginTop:6}}>
                      <Field label="Son Nakliye Ücreti (₺)">
                        <NumInp value={f.nakliye?.ortalamaUcret||0} onChange={v=>up("nakliye",{...f.nakliye,ortalamaUcret:v})} step={1} style={{width:"100%"}}/>
                      </Field>
                      <Field label={`Son Nakliye Yükü (${f.birim||"birim"})`}>
                        <NumInp value={f.nakliye?.ortalamaYuk||0} onChange={v=>up("nakliye",{...f.nakliye,ortalamaYuk:v})} step={1} style={{width:"100%"}}/>
                      </Field>
                    </div>
                    {f.nakliye?.ortalamaUcret>0&&f.nakliye?.ortalamaYuk>0&&(
                      <div style={{marginTop:8,display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:10,color:C.muted}}>→ Birim nakliye:</span>
                        <span style={{fontSize:13,fontWeight:800,color:"#E8914A",fontFamily:"JetBrains Mono,SF Mono,monospace"}}>
                          {(f.nakliye.ortalamaUcret/f.nakliye.ortalamaYuk).toFixed(2)}₺/{f.birim||"birim"}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <Field label="Not"><TextInp value={f.notlar} onChange={v=>up("notlar",v)} placeholder=""/></Field>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4}}>
            <div style={{display:"flex",gap:6}}>
              {isEdit&&<SilButonu onDelete={()=>onDelete(f.id)} isim={f.ad}/>}
              {isEdit&&onKopya&&<button onClick={()=>onKopya(f)}
                style={{background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 13px",fontSize:12,color:C.sub,cursor:"pointer"}}>📋 Kopyasını Oluştur</button>}
            </div>
            <div style={{display:"flex",gap:8}}>
              <Btn onClick={onClose}>İptal</Btn>
              <Btn variant="primary" color={C.sky} onClick={()=>onSave(f)}>{isEdit?"Kaydet":"Ekle"}</Btn>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

function YariMamulModal({kalem,hamMaddeler,yarimamulList,hizmetler,onClose,onSave,onDelete,onKopya}){
  const isEdit=!!kalem?.id;
  const [f,setF]=useState(kalem||{kod:"",ad:"",kategori:"",birim:"adet",miktar:0,minStok:0,notlar:"",bom:[]});
  const up=(k,v)=>setF(p=>({...p,[k]:v}));
  const malBom=f.bom.reduce((s,b)=>{
    const liste=[...hamMaddeler,...yarimamulList,...hizmetler];
    const k=liste.find(x=>x.id===b.kalemId);
    if(!k) return s;
    return s + bomKalemMaliyet(k, b.miktar, b.birim, hamMaddeler, yarimamulList, hizmetler);
  },0);
  return(
    <Modal title={isEdit?"Yarı Mamül Düzenle":f._kopya?"Yarı Mamül Kopyası":"Yeni Yarı Mamül"} onClose={onClose} width={680}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Field label="Kod"><TextInp value={f.kod} onChange={v=>up("kod",v)} placeholder="YM-001"/></Field>
        <Field label="Kategori">
          <div style={{position:"relative"}}>
            <input value={f.kategori} onChange={e=>up("kategori",e.target.value)}
              list="ym-kat-list" placeholder="Metal, Kumaş, İskelet..."
              className="inp" style={{width:"100%",background:"rgba(255,255,255,.04)",
              border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 12px",fontSize:13,color:C.text}}/>
            <datalist id="ym-kat-list">
              {[...new Set([...hamMaddeler.map(x=>x.kategori),...yarimamulList.map(x=>x.kategori)].filter(Boolean))].map(k=>(
                <option key={k} value={k}/>
              ))}
            </datalist>
          </div>
        </Field>
      </div>
      <Field label="Yarı Mamül Adı"><TextInp value={f.ad} onChange={v=>up("ad",v)} placeholder="TT-001 Boyalı İskelet"/></Field>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
        <Field label="Birim"><TextInp value={f.birim} onChange={v=>up("birim",v)} placeholder="adet"/></Field>
        <Field label="Mevcut Miktar"><NumInp value={f.miktar} onChange={v=>up("miktar",v)} style={{width:"100%"}}/></Field>
        <Field label="Min Stok"><NumInp value={f.minStok} onChange={v=>up("minStok",v)} style={{width:"100%"}}/></Field>
      </div>
      <div style={{marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:.6}}>⚙ Üretim Reçetesi</div>
          {malBom>0&&<div style={{background:"rgba(232,145,74,.1)",border:`1px solid rgba(232,145,74,.25)`,borderRadius:8,padding:"3px 10px",fontSize:12,fontWeight:700,color:C.cyan}}>Birim Maliyet: {fmt(malBom)}₺</div>}
        </div>
        <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:11,padding:"10px"}}>
          <BomEditor bom={f.bom} onChange={bom=>up("bom",bom)} hamMaddeler={hamMaddeler} yarimamulList={yarimamulList} hizmetler={hizmetler} kendisi={f.id}/>
        </div>
      </div>
      <Field label="Not"><TextInp value={f.notlar} onChange={v=>up("notlar",v)}/></Field>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4}}>
        <div style={{display:"flex",gap:6}}>
          {isEdit&&<SilButonu onDelete={()=>onDelete(f.id)} isim={f.ad}/>}
          {isEdit&&onKopya&&<button onClick={()=>onKopya(f)}
            style={{background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 13px",fontSize:12,color:C.sub,cursor:"pointer"}}>📋 Kopyasını Oluştur</button>}
        </div>
        <div style={{display:"flex",gap:8}}><Btn onClick={onClose}>İptal</Btn><Btn variant="primary" onClick={()=>onSave(f)}>{isEdit?"Kaydet":"Ekle"}</Btn></div>
      </div>
    </Modal>
  );
}

function UrunBomModal({kalem,hamMaddeler,yarimamulList,hizmetler,onClose,onSave,onDelete,onKopya}){
  const isEdit=!!kalem?.id;
  const [f,setF]=useState(kalem||{kod:"",ad:"",kategori:"",birim:"adet",miktar:0,minStok:0,satisKdvDahil:0,satisKdv:10,notlar:"",bom:[]});
  const up=(k,v)=>setF(p=>({...p,[k]:v}));
  const malBom=f.bom.reduce((s,b)=>{
    const liste=[...hamMaddeler,...yarimamulList,...hizmetler];
    const k=liste.find(x=>x.id===b.kalemId);
    if(!k) return s;
    return s + bomKalemMaliyet(k, b.miktar, b.birim, hamMaddeler, yarimamulList, hizmetler);
  },0);
  const saleNet=f.satisKdvDahil/(1+f.satisKdv/100);
  const kar=saleNet-malBom, marj=saleNet>0?(kar/saleNet)*100:0;
  return(
    <Modal title={isEdit?"Ürün Düzenle":f._kopya?"Ürün Kopyası":"Yeni Ürün"} onClose={onClose} width={680}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Field label="Ürün Kodu"><TextInp value={f.kod} onChange={v=>up("kod",v)} placeholder="UR-001"/></Field>
        <Field label="Kategori"><TextInp value={f.kategori} onChange={v=>up("kategori",v)} placeholder="Tabure, Sandalye..."/></Field>
      </div>
      <Field label="Ürün Adı"><TextInp value={f.ad} onChange={v=>up("ad",v)} placeholder="Trio Tabure"/></Field>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
        <Field label="Satış Fiyatı (KDV dahil ₺)"><NumInp value={f.satisKdvDahil} onChange={v=>up("satisKdvDahil",v)} step={1} style={{width:"100%"}}/></Field>
        <Field label="Satış KDV %">
          <select value={String(f.satisKdv)} onChange={e=>up("satisKdv",parseInt(e.target.value))}
            style={{width:"100%",background:C.s3,border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 12px",fontSize:13,color:C.text,cursor:"pointer"}}>
            {["0","10","20"].map(v=><option key={v} value={v} style={{background:C.s2}}>%{v}</option>)}
          </select>
        </Field>
        <Field label="Stok (adet)"><NumInp value={f.miktar} onChange={v=>up("miktar",v)} style={{width:"100%"}}/></Field>
      </div>
      {malBom>0&&f.satisKdvDahil>0&&(
        <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
          {[["Maliyet",`${fmt(malBom)}₺`,C.coral],["Net Satış",`${fmt(saleNet)}₺`,C.text],["Kâr",`${fmt(kar)}₺`,kar>0?C.mint:C.coral],["Marj",`%${fmt(marj,1)}`,marj>20?C.mint:marj>10?C.gold:C.coral]].map(([l,v,c],i)=>(
            <div key={i} style={{background:`${c}0D`,border:`1px solid ${c}1A`,borderRadius:9,padding:"6px 12px",textAlign:"center",flex:1,minWidth:70}}>
              <div style={{fontSize:9,color:C.muted,marginBottom:2}}>{l}</div>
              <div style={{fontSize:13,fontWeight:700,color:c,fontFamily:F}}>{v}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{marginBottom:14}}>
        <div style={{fontSize:11,fontWeight:700,color:C.sub,textTransform:"uppercase",letterSpacing:.6,marginBottom:8}}>⚙ Ürün Reçetesi</div>
        <div style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:11,padding:"10px"}}>
          <BomEditor bom={f.bom} onChange={bom=>up("bom",bom)} hamMaddeler={hamMaddeler} yarimamulList={yarimamulList} hizmetler={hizmetler} kendisi={f.id}/>
        </div>
      </div>
      <Field label="Not"><TextInp value={f.notlar} onChange={v=>up("notlar",v)}/></Field>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4}}>
        <div style={{display:"flex",gap:6}}>
          {isEdit&&<SilButonu onDelete={()=>onDelete(f.id)} isim={f.ad}/>}
          {isEdit&&onKopya&&<button onClick={()=>onKopya(f)}
            style={{background:"rgba(255,255,255,.05)",border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 13px",fontSize:12,color:C.sub,cursor:"pointer"}}>📋 Kopyasını Oluştur</button>}
        </div>
        <div style={{display:"flex",gap:8}}><Btn onClick={onClose}>İptal</Btn><Btn variant="primary" color={C.mint} onClick={()=>onSave(f)}>{isEdit?"Kaydet":"Ekle"}</Btn></div>
      </div>
    </Modal>
  );
}

// ── MODAL: FASON HİZMET ───────────────────────────────────────────────────────
function FasonHizmetModal({kalem,onClose,onSave,onDelete}){
  const isEdit=!!kalem?.id;
  const [f,setF]=useState(kalem||{kod:"",ad:"",tip:"fason",firma:"",tel:"",adres:"",birim:"adet",birimFiyat:0,kdv:20,sureGun:1,notlar:"",
    // ── Kapasite Bilgileri ──
    gunlukKapasite:0,        // Bize günlük yapabilecekleri kapasite (adet/gün)
    oncedenHaberGun:3,       // Kaç gün önceden haber vermek lazım
    minPartiBuyukluk:0,      // Minimum parti büyüklüğü
  });
  const up=(k,v)=>setF(p=>({...p,[k]:v}));
  const netTl=f.birimFiyat*(1+f.kdv/100);
  return(
    <Modal title={isEdit?"Fason Hizmet Düzenle":"Yeni Fason Hizmet"} onClose={onClose} width={540}>
      {/* Üst bilgi banner */}
      <div style={{background:"rgba(124,92,191,.08)",border:"1px solid rgba(124,92,191,.2)",borderRadius:10,
        padding:"10px 14px",marginBottom:16,display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:20}}>🏭</span>
        <div>
          <div style={{fontSize:12,fontWeight:600,color:C.lav}}>Fason / Dış Hizmet</div>
          <div style={{fontSize:11,color:C.muted}}>Dışarıdan satın alınan üretim hizmeti — firma ve fiyat bilgisi girilir</div>
        </div>
      </div>

      {/* Hizmet adı + kod */}
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:12}}>
        <Field label="Hizmet Adı"><TextInp value={f.ad} onChange={v=>up("ad",v)} placeholder="Statik Boya, Lazer Kesim..."/></Field>
        <Field label="Kod"><TextInp value={f.kod} onChange={v=>up("kod",v)} placeholder="FS-001"/></Field>
      </div>

      {/* Firma bilgileri */}
      <div style={{background:"rgba(255,255,255,.03)",border:`1px solid ${C.border}`,borderRadius:11,padding:"12px 14px",marginBottom:2}}>
        <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>🏢 Hizmet Alınan Firma</div>
        <Field label="Firma Adı"><TextInp value={f.firma} onChange={v=>up("firma",v)} placeholder="Boya Atölyesi A, Metal Lazer B..."/></Field>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:0}}>
          <Field label="Telefon"><TextInp value={f.tel||""} onChange={v=>up("tel",v)} placeholder="0532 xxx xx xx"/></Field>
          <Field label="Adres / Not"><TextInp value={f.adres||""} onChange={v=>up("adres",v)} placeholder="İkitelli OSB..."/></Field>
        </div>
      </div>

      {/* Fiyat ve süre */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginTop:12}}>
        <Field label="Birim">
          <select value={f.birim} onChange={e=>up("birim",e.target.value)}
            style={{width:"100%",background:C.s3,border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 10px",fontSize:12,color:C.text,cursor:"pointer"}}>
            {["adet","mt","m2","kg","boy","set","plaka"].map(v=><option key={v} value={v} style={{background:C.s2}}>{v}</option>)}
          </select>
        </Field>
        <Field label="Birim Fiyat (₺)"><NumInp value={f.birimFiyat} onChange={v=>up("birimFiyat",v)} step={0.5} style={{width:"100%"}}/></Field>
        <Field label="KDV %">
          <select value={String(f.kdv)} onChange={e=>up("kdv",parseInt(e.target.value))}
            style={{width:"100%",background:C.s3,border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 10px",fontSize:12,color:C.text,cursor:"pointer"}}>
            {["0","10","20"].map(v=><option key={v} value={v} style={{background:C.s2}}>%{v}</option>)}
          </select>
        </Field>
        <Field label="KDV'li Fiyat">
          <div style={{background:"rgba(124,92,191,.1)",border:"1px solid rgba(124,92,191,.22)",borderRadius:9,
            padding:"9px 10px",fontSize:14,fontWeight:700,color:C.lav}}>{fmt(netTl)}₺</div>
        </Field>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:12}}>
        <Field label="Ortalama Bekleme (gün)"><NumInp value={f.sureGun} onChange={v=>up("sureGun",v)} step={0.5} style={{width:"100%"}}/></Field>
        <Field label="Not"><TextInp value={f.notlar} onChange={v=>up("notlar",v)} placeholder="Özel notlar, ödeme koşulları..."/></Field>
      </div>

      {/* ── Kapasite & Planlama Bilgileri ── */}
      <div style={{background:"rgba(124,92,191,.05)",border:"1px solid rgba(124,92,191,.18)",borderRadius:11,padding:"12px 14px",marginTop:8,marginBottom:2}}>
        <div style={{fontSize:10,fontWeight:700,color:C.lav,letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>📊 Kapasite & Planlama</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
          <Field label="Günlük Kapasite (adet/gün)">
            <NumInp value={f.gunlukKapasite} onChange={v=>up("gunlukKapasite",v)} step={10} placeholder="720" style={{width:"100%"}}/>
          </Field>
          <Field label="Önceden Haber (gün)">
            <NumInp value={f.oncedenHaberGun} onChange={v=>up("oncedenHaberGun",v)} step={1} placeholder="3" style={{width:"100%"}}/>
          </Field>
          <Field label="Min Parti Büyüklüğü">
            <NumInp value={f.minPartiBuyukluk} onChange={v=>up("minPartiBuyukluk",v)} step={10} placeholder="100" style={{width:"100%"}}/>
          </Field>
        </div>
        {/* Hesaplanmış özet */}
        {f.gunlukKapasite>0&&(
          <div style={{marginTop:8,padding:"8px 10px",background:"rgba(124,92,191,.08)",borderRadius:8,
            display:"flex",gap:16,flexWrap:"wrap",alignItems:"center"}}>
            <div>
              <div style={{fontSize:9,color:C.muted}}>Günlük Kapasite</div>
              <div style={{fontSize:16,fontWeight:800,color:C.lav,fontFamily:F}}>{f.gunlukKapasite} <span style={{fontSize:10,fontWeight:400}}>adet/gün</span></div>
            </div>
            {f.oncedenHaberGun>0&&<div>
              <div style={{fontSize:9,color:C.muted}}>Planlama</div>
              <div style={{fontSize:11,color:C.gold}}>⏱ {f.oncedenHaberGun} gün önceden haber + {f.sureGun} gün bekleme</div>
            </div>}
            {f.birimFiyat>0&&<div>
              <div style={{fontSize:9,color:C.muted}}>Günlük Maliyet</div>
              <div style={{fontSize:11,color:C.cyan}}>{fmt(f.gunlukKapasite*f.birimFiyat)}₺/gün</div>
            </div>}
          </div>
        )}
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:6}}>
        {isEdit
          ?<SilButonu onDelete={()=>onDelete(f.id)} isim={f.ad}/>
          :<span/>}
        <div style={{display:"flex",gap:8}}>
          <Btn onClick={onClose}>İptal</Btn>
          <Btn variant="primary" color={C.lav} onClick={()=>onSave({...f,tip:"fason"})}>{isEdit?"Kaydet":"Ekle"}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ── MODAL: İÇ İŞÇİLİK ────────────────────────────────────────────────────────
function IscilikModal({kalem,istasyonlar,calisanlar,onClose,onSave,onDelete}){
  const isEdit=!!kalem?.id;
  const [f,setF]=useState(kalem||{kod:"",ad:"",tip:"ic",istasyon:"",calisan:"",birim:"adet",sureDkAdet:0,birimFiyat:0,kdv:0,notlar:""});
  const up=(k,v)=>setF(p=>({...p,[k]:v}));
  // sureDkAdet = saniye cinsinden işlem süresi
  // Saatlik ücret hesabı: birimFiyat / (sureDkAdet / 3600)
  const saatUcret = f.sureDkAdet>0 ? (f.birimFiyat / (f.sureDkAdet/3600)) : null;
  const icIstasyonlar=(istasyonlar||[]).filter(x=>x.tip==="ic"||!x.tip);
  const icCalisanlar=(calisanlar||[]).filter(x=>x.durum==="aktif");
  const [saatModu,setSaatModu]=useState(false);
  const [saatUcretGiris,setSaatUcretGiris]=useState(
    f.sureDkAdet>0 ? fmt(f.birimFiyat/(f.sureDkAdet/3600),0) : ""
  );
  const [manuelIstasyon,setManuelIstasyon]=useState("");
  const handleSaatUcret=(v)=>{
    setSaatUcretGiris(v);
    // saatlik ücret × (sn / 3600) = birim ücret
    if(f.sureDkAdet>0&&v>0) up("birimFiyat", Math.round(v*(f.sureDkAdet/3600)*100)/100);
  };
  // Süre gösterimi: sn → dk sn formatı
  const snGoster=(sn)=>sn>=60?Math.floor(sn/60)+"dk "+(sn%60>0?sn%60+"sn":""):sn+"sn";

  return(
    <Modal title={isEdit?"İşçilik Düzenle":"Yeni İşçilik Tanımı"} onClose={onClose} width={560}>
      {/* Üst bilgi banner */}
      <div style={{background:"rgba(245,158,11,.07)",border:"1px solid rgba(245,158,11,.2)",borderRadius:10,
        padding:"10px 14px",marginBottom:16,display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:20}}>👷</span>
        <div>
          <div style={{fontSize:12,fontWeight:600,color:C.gold}}>İç İşçilik</div>
          <div style={{fontSize:11,color:C.muted}}>Atölye içinde yapılan üretim adımı — istasyon ve süre eşleşmesi yapılır</div>
        </div>
      </div>

      {/* İşlem adı + kod */}
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:12}}>
        <Field label="İşlem Adı"><TextInp value={f.ad} onChange={v=>up("ad",v)} placeholder="Döşeme, Montaj, Kumaş Kesim..."/></Field>
        <Field label="Kod"><TextInp value={f.kod} onChange={v=>up("kod",v)} placeholder="IC-001"/></Field>
      </div>

      {/* İstasyon + Çalışan eşleşmesi */}
      <div style={{background:"rgba(255,255,255,.03)",border:`1px solid ${C.border}`,borderRadius:11,padding:"12px 14px",marginBottom:2}}>
        <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>⚙ İstasyon & Çalışan Eşleşmesi</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <Field label="İstasyon">
            <select value={f.istasyon} onChange={e=>up("istasyon",e.target.value)}
              style={{width:"100%",background:C.s3,border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 12px",fontSize:13,color:f.istasyon?C.text:C.muted,cursor:"pointer"}}>
              <option value="" style={{background:C.s2}}>— Seçin —</option>
              {icIstasyonlar.map(ist=><option key={ist.id} value={ist.ad} style={{background:C.s2}}>{ist.ad}</option>)}
              <option value="__manuel__" style={{background:C.s2}}>+ Manuel gir</option>
            </select>
          </Field>
          <Field label="Sorumlu Çalışan">
            <select value={f.calisan} onChange={e=>up("calisan",e.target.value)}
              style={{width:"100%",background:C.s3,border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 12px",fontSize:13,color:f.calisan?C.text:C.muted,cursor:"pointer"}}>
              <option value="" style={{background:C.s2}}>— Seçin —</option>
              {icCalisanlar.map(c=><option key={c.id} value={c.ad} style={{background:C.s2}}>{c.ad}</option>)}
            </select>
          </Field>
        </div>
        {f.istasyon==="__manuel__"&&(
          <div style={{marginTop:8}}>
            <Field label="İstasyon Adı (manuel)"><TextInp value={manuelIstasyon} onChange={v=>{setManuelIstasyon(v);}} placeholder="İstasyon adı..."/></Field>
          </div>
        )}
      </div>

      {/* Süre ve ücret */}
      <div style={{background:"rgba(255,255,255,.03)",border:`1px solid ${C.border}`,borderRadius:11,padding:"12px 14px",marginBottom:2}}>
        <div style={{fontSize:10,fontWeight:700,color:C.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>⏱ Süre & Ücret</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:10}}>
          <Field label="İşlem Süresi (saniye)" hint="Örn: 2700 = 45 dakika">
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <NumInp value={f.sureDkAdet} onChange={v=>{
                const sn=Math.round(v||0);
                up("sureDkAdet",sn);
                if(saatModu&&saatUcretGiris>0) up("birimFiyat",Math.round(saatUcretGiris*(sn/3600)*100)/100);
              }} step={30} min={0} style={{flex:1}}/>
              {f.sureDkAdet>0&&<span style={{fontSize:11,color:C.gold,whiteSpace:"nowrap",minWidth:60}}>{snGoster(f.sureDkAdet)}</span>}
            </div>
          </Field>
          <Field label="Birim">
            <select value={f.birim} onChange={e=>up("birim",e.target.value)}
              style={{width:"100%",background:C.s3,border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 12px",fontSize:13,color:C.text,cursor:"pointer"}}>
              {["adet","mt","m2","set"].map(v=><option key={v} value={v} style={{background:C.s2}}>{v}</option>)}
            </select>
          </Field>
        </div>
        {/* Ücret giriş modu toggle */}
        <div style={{display:"flex",gap:5,marginBottom:10}}>
          {[["adet","Birim başına (₺/adet)"],["saat","Saatlik ücret (₺/saat)"]].map(([m,l])=>(
            <button key={m} onClick={()=>setSaatModu(m==="saat")} style={{flex:1,padding:"7px",borderRadius:8,cursor:"pointer",
              border:`1px solid ${(saatModu===(m==="saat"))?C.gold+"50":C.border}`,
              background:(saatModu===(m==="saat"))?`${C.gold}10`:"rgba(255,255,255,.02)",
              color:(saatModu===(m==="saat"))?C.gold:C.muted,fontSize:11,fontFamily:FB,transition:"all .15s"}}>{l}</button>
          ))}
        </div>
        {!saatModu?(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
            <Field label="Birim Ücret (₺)"><NumInp value={f.birimFiyat} onChange={v=>up("birimFiyat",v)} step={0.5} style={{width:"100%"}}/></Field>
            <Field label="KDV %">
              <select value={String(f.kdv)} onChange={e=>up("kdv",parseInt(e.target.value))}
                style={{width:"100%",background:C.s3,border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 10px",fontSize:12,color:C.text,cursor:"pointer"}}>
                {["0","10","20"].map(v=><option key={v} value={v} style={{background:C.s2}}>%{v}</option>)}
              </select>
            </Field>
            {saatUcret&&(
              <Field label="≈ Saatlik Ücret">
                <div style={{background:"rgba(245,158,11,.1)",border:"1px solid rgba(245,158,11,.22)",borderRadius:9,
                  padding:"9px 12px",fontSize:13,fontWeight:700,color:C.gold}}>{fmt(saatUcret)}₺/sa</div>
              </Field>
            )}
          </div>
        ):(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
            <Field label="Saatlik Ücret (₺)"><NumInp value={saatUcretGiris} onChange={handleSaatUcret} step={5} style={{width:"100%"}}/></Field>
            <Field label="KDV %">
              <select value={String(f.kdv)} onChange={e=>up("kdv",parseInt(e.target.value))}
                style={{width:"100%",background:C.s3,border:`1px solid ${C.border}`,borderRadius:9,padding:"9px 10px",fontSize:12,color:C.text,cursor:"pointer"}}>
                {["0","10","20"].map(v=><option key={v} value={v} style={{background:C.s2}}>%{v}</option>)}
              </select>
            </Field>
            <Field label="≈ Birim Ücret">
              <div style={{background:"rgba(245,158,11,.1)",border:"1px solid rgba(245,158,11,.22)",borderRadius:9,
                padding:"9px 12px",fontSize:13,fontWeight:700,color:C.gold}}>{fmt(f.birimFiyat)}₺/{f.birim}</div>
            </Field>
          </div>
        )}
        {f.sureDkAdet>0&&(
          <div style={{marginTop:8,display:"flex",gap:12,fontSize:11,color:C.muted}}>
            <span>📊 {Math.floor(28800/f.sureDkAdet)} adet/gün kapasitesi (8 saatlik vardiya)</span>
            {f.birimFiyat>0&&<span>· {fmt(f.birimFiyat*(28800/f.sureDkAdet))}₺/gün üretim maliyeti</span>}
          </div>
        )}
      </div>

      <Field label="Not"><TextInp value={f.notlar} onChange={v=>up("notlar",v)} placeholder="Özel notlar..."/></Field>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:6}}>
        {isEdit
          ?<SilButonu onDelete={()=>onDelete(f.id)} isim={f.ad}/>
          :<span/>}
        <div style={{display:"flex",gap:8}}>
          <Btn onClick={onClose}>İptal</Btn>
          <Btn variant="primary" color={C.gold} onClick={()=>onSave({...f,tip:"ic",istasyon:f.istasyon==="__manuel__"?manuelIstasyon:f.istasyon})}>{isEdit?"Kaydet":"Ekle"}</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ── MODAL: OTOMATİK KOD OLUŞTURUCU (Claude API) ──────────────────────────────
function OtomatikKodModal({urunler,hamMaddeler,yarimamulList,hizmetler,urunBomList,onClose,onApply}){
  const [durum,setDurum]=useState("hazir"); // hazir | yukleniyor | onizleme | hata
  const [kodOneriler,setKodOneriler]=useState([]); // [{id, tip, mevcutKod, mevcutAd, yeniKod, aciklama}]
  const [hata,setHata]=useState("");
  const [secili,setSecili]=useState({}); // id→boolean (hangi kodlar onaylı)

  const sistemOzetle=()=>{
    // Tüm BOM bağlantılarını çıkar — hangi ham madde/ym hangi ürünlerde kullanılıyor
    const urundeKullanilan={}; // hmId/ymId → [urunAd]
    urunBomList.forEach(ur=>{
      (ur.bom||[]).forEach(row=>{
        const key=row.kalemId;
        if(!urundeKullanilan[key]) urundeKullanilan[key]=[];
        urundeKullanilan[key].push(ur.ad);
      });
    });
    // Yarı mamüllerin BOM'larındaki ham maddeler
    yarimamulList.forEach(ym=>{
      (ym.bom||[]).forEach(row=>{
        const key=row.kalemId;
        if(!urundeKullanilan[key]) urundeKullanilan[key]=[];
        urundeKullanilan[key].push(`(YM: ${ym.ad})`);
      });
    });

    return {
      urunler: urunler.map(u=>({id:u.id, ad:u.ad, kategori:u.kategori, mevcutKod:u.kod})),
      yarimamullar: yarimamulList.map(y=>({id:y.id, ad:y.ad, mevcutKod:y.kod, kullanildigiBomlar:urundeKullanilan[y.id]||[]})),
      hamMaddeler: hamMaddeler.map(h=>({id:h.id, ad:h.ad, kategori:h.kategori, mevcutKod:h.kod, kullanildigiYerler:urundeKullanilan[h.id]||[]})),
      hizmetler: hizmetler.map(h=>({id:h.id, ad:h.ad, tip:h.tip, mevcutKod:h.kod})),
      urunBomlar: urunBomList.map(u=>({
        id:u.id, ad:u.ad, mevcutKod:u.kod,
        malzemeler:(u.malBom||[]).map(r=>r.kalemId)
      }))
    };
  };

  const kodolustur=async()=>{
    setDurum("yukleniyor");
    setHata("");
    const ozet=sistemOzetle();
    const prompt=`Sen bir mobilya/metal atölyesi üretim yazılımının akıllı kod oluşturma motorusun.

Aşağıdaki atölye sistemindeki tüm kalemlere anlamlı, tutarlı ve otomatik kodlar oluştur.

## KOD KURALLARI
- **Ürünler**: Ürün adından 2-4 harfli kısaltma + sıra → TAB-001, SND-001, MSA-001
- **Yarı Mamüller**: Ait olduğu ürün kodu + YM + sıra → TAB-YM01, TAB-YM02 (birden fazla üründe kullanılanlar genel: YM-001)
- **Ham Maddeler**: Kategori kısaltması + sıra → PRF-001 (Profil), BRU-001 (Boru), KMS-001 (Kumaş), SNG-001 (Sünger), SNT-001 (Sunta), AKS-001 (Aksesuar), genel: HM-001
- **Fason Hizmetler**: FSN-001, FSN-002...
- **İç İşçilik**: ISC-001, ISC-002...
- **Ürün BOM'ları** (stok>ürün kaydı): Ürün kodu + BOM → TAB-BOM

## TÜRKÇE KATEGORİ KISALTMALARI
Profil→PRF, Boru→BRU, Kumaş→KMS, Sünger→SNG, Sunta→SNT, Aksesuar→AKS,
Tabla→TBL, Ayak→AYK, Kaplama→KPL, Boya→BYA, Yapıştırıcı→YPS

## SİSTEM VERİSİ
${JSON.stringify(ozet, null, 2)}

## YANIT FORMATI
Sadece JSON döndür, başka hiçbir şey yazma:
{
  "kodlar": [
    {"id": "...", "tip": "urun|yarimamul|hammadde|hizmet|urunbom", "yeniKod": "TAB-001", "aciklama": "Trio Tabure → TAB"},
    ...
  ]
}`;

    try{
      // NOT: API key olmadan bu istek calisMAZ.
      // Production'da backend proxy uzerinden yapilmali, client-side API key YASAK.
      const apiKey=localStorage.getItem("atolye_anthropic_key")||"";
      if(!apiKey){
        alert("AI ozelligi icin Genel Ayarlar'dan Anthropic API Key giriniz.");
        setLoading(false);
        return;
      }
      const res=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "x-api-key":apiKey,
          "anthropic-version":"2023-06-01",
          "anthropic-dangerous-direct-browser-access":"true"
        },
        body:JSON.stringify({
          model:"claude-sonnet-4-20250514",
          max_tokens:1000,
          messages:[{role:"user",content:prompt}]
        })
      });
      const data=await res.json();
      const raw=data.content?.find(b=>b.type==="text")?.text||"";
      // JSON temizle
      const jsonStr=raw.replace(/```json|```/g,"").trim();
      const parsed=JSON.parse(jsonStr);
      const oneriler=parsed.kodlar||[];

      // Mevcut adları bul
      const tumKalemler=[
        ...urunler.map(x=>({...x,tip:"urun"})),
        ...yarimamulList.map(x=>({...x,tip:"yarimamul"})),
        ...hamMaddeler.map(x=>({...x,tip:"hammadde"})),
        ...hizmetler.map(x=>({...x,tip:"hizmet"})),
        ...urunBomList.map(x=>({...x,tip:"urunbom"}))
      ];
      const kalemMap={};
      tumKalemler.forEach(k=>kalemMap[k.id]=k);

      const zenginOneriler=oneriler.map(o=>({
        ...o,
        mevcutKod:kalemMap[o.id]?.kod||"—",
        mevcutAd:kalemMap[o.id]?.ad||o.id,
      }));

      setKodOneriler(zenginOneriler);
      // Hepsini varsayılan seçili yap
      const yeniSecili={};
      zenginOneriler.forEach(o=>yeniSecili[o.id]=true);
      setSecili(yeniSecili);
      setDurum("onizleme");
    }catch(e){
      console.error(e);
      setHata("Claude API hatası: "+e.message);
      setDurum("hata");
    }
  };

  const uygula=()=>{
    const kodMap={};
    kodOneriler.forEach(o=>{
      if(secili[o.id]) kodMap[o.id]=o.yeniKod;
    });
    onApply(kodMap);
  };

  const tipRenk={urun:C.cyan,yarimamul:C.mint,hammadde:C.sky,hizmet:C.lav,urunbom:C.gold};
  const tipEtiket={urun:"Ürün",yarimamul:"Yarı Mamül",hammadde:"Ham Madde",hizmet:"Hizmet",urunbom:"Ürün BOM"};

  return(
    <Modal title="🤖 Otomatik Kod Oluşturucu" onClose={onClose} width={700}>
      {durum==="hazir"&&(
        <div style={{textAlign:"center",padding:"32px 16px"}}>
          <div style={{fontSize:48,marginBottom:16}}>🤖</div>
          <div style={{fontSize:16,fontWeight:700,color:C.text,marginBottom:8}}>Tüm Sistemi Analiz Et</div>
          <div style={{fontSize:13,color:C.muted,lineHeight:1.7,marginBottom:24,maxWidth:440,margin:"0 auto 24px"}}>
            Claude yapay zeka sistemindeki tüm ürünleri, yarı mamülleri, ham maddeleri
            ve hizmetleri analiz ederek anlamlı ve tutarlı kodlar önerir.
            Onizleme ekranında istediğini değiştirebilir, istediğini uygulayabilirsin.
          </div>
          <div style={{display:"flex",justifyContent:"center",gap:12,flexWrap:"wrap",marginBottom:28}}>
            {[
              ["📦",`${urunler.length} Ürün`],
              ["🔧",`${yarimamulList.length} Yarı Mamül`],
              ["🏗️",`${hamMaddeler.length} Ham Madde`],
              ["⚙️",`${hizmetler.length} Hizmet`],
            ].map(([ic,lb])=>(
              <div key={lb} style={{background:"rgba(255,255,255,.04)",border:`1px solid ${C.border}`,
                borderRadius:10,padding:"10px 16px",fontSize:12,color:C.sub}}>
                <span style={{fontSize:18,marginRight:6}}>{ic}</span>{lb}
              </div>
            ))}
          </div>
          <button onClick={kodolustur}
            style={{background:"linear-gradient(135deg,rgba(139,92,246,.3),rgba(59,130,246,.2))",
              border:"1px solid rgba(139,92,246,.4)",borderRadius:12,padding:"13px 32px",
              fontSize:15,fontWeight:700,color:"#a78bfa",cursor:"pointer",transition:"all .2s"}}>
            🚀 Kodları Oluştur
          </button>
        </div>
      )}

      {durum==="yukleniyor"&&(
        <div style={{textAlign:"center",padding:"48px 16px"}}>
          <div style={{fontSize:42,marginBottom:16,animation:"spin 1s linear infinite",display:"inline-block"}}>⚙️</div>
          <div style={{fontSize:15,color:C.sub,marginBottom:8}}>Claude analiz ediyor...</div>
          <div style={{fontSize:12,color:C.muted}}>Tüm BOM ağacı ve üretim zinciri inceleniyor</div>
          <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {durum==="hata"&&(
        <div style={{textAlign:"center",padding:"32px"}}>
          <div style={{fontSize:36,marginBottom:12}}>⚠️</div>
          <div style={{fontSize:13,color:C.coral,marginBottom:20}}>{hata}</div>
          <Btn onClick={()=>setDurum("hazir")}>← Tekrar Dene</Btn>
        </div>
      )}

      {durum==="onizleme"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div style={{fontSize:13,color:C.sub}}>
              {kodOneriler.length} kod önerisi · 
              <span style={{color:C.mint}}> {Object.values(secili).filter(Boolean).length} seçili</span>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setSecili(Object.fromEntries(kodOneriler.map(o=>[o.id,true])))}
                style={{background:"transparent",border:`1px solid ${C.border}`,borderRadius:7,
                  padding:"4px 10px",fontSize:11,color:C.sub,cursor:"pointer"}}>Tümünü Seç</button>
              <button onClick={()=>setSecili({})}
                style={{background:"transparent",border:`1px solid ${C.border}`,borderRadius:7,
                  padding:"4px 10px",fontSize:11,color:C.sub,cursor:"pointer"}}>Hiçbirini Seçme</button>
            </div>
          </div>

          <div style={{maxHeight:420,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
            {["urun","yarimamul","hammadde","hizmet","urunbom"].map(tip=>{
              const grup=kodOneriler.filter(o=>o.tip===tip);
              if(!grup.length) return null;
              return(
                <div key={tip}>
                  <div style={{fontSize:10,fontWeight:700,color:tipRenk[tip]||C.muted,
                    padding:"8px 4px 4px",letterSpacing:.5,textTransform:"uppercase"}}>
                    {tipEtiket[tip]||tip} ({grup.length})
                  </div>
                  {grup.map(o=>(
                    <div key={o.id} onClick={()=>setSecili(p=>({...p,[o.id]:!p[o.id]}))}
                      style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:9,
                        cursor:"pointer",marginBottom:2,border:`1px solid ${secili[o.id]?(tipRenk[o.tip]||C.border)+"44":C.border}`,
                        background:secili[o.id]?`${tipRenk[o.tip]||C.border}08`:"transparent",
                        transition:"all .15s"}}>
                      <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${secili[o.id]?tipRenk[o.tip]||C.cyan:C.border}`,
                        background:secili[o.id]?tipRenk[o.tip]||C.cyan:"transparent",flexShrink:0,
                        display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#fff",transition:"all .15s"}}>
                        {secili[o.id]?"✓":""}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,color:C.text,fontWeight:500,
                          whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{o.mevcutAd}</div>
                        {o.aciklama&&<div style={{fontSize:10,color:C.muted,marginTop:1}}>{o.aciklama}</div>}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                        <span style={{fontSize:11,color:C.muted,textDecoration:"line-through"}}>{o.mevcutKod}</span>
                        <span style={{fontSize:11,color:C.muted}}>→</span>
                        <span style={{fontSize:12,fontWeight:700,color:tipRenk[o.tip]||C.cyan,
                          background:`${tipRenk[o.tip]||C.cyan}15`,borderRadius:5,padding:"2px 7px"}}>{o.yeniKod}</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:16,
            paddingTop:14,borderTop:`1px solid ${C.border}`}}>
            <Btn onClick={()=>setDurum("hazir")}>← Yeniden Oluştur</Btn>
            <div style={{display:"flex",gap:8}}>
              <Btn onClick={onClose}>İptal</Btn>
              <button onClick={uygula}
                style={{background:"linear-gradient(135deg,rgba(139,92,246,.4),rgba(59,130,246,.3))",
                  border:"1px solid rgba(139,92,246,.5)",borderRadius:9,padding:"8px 20px",
                  fontSize:13,fontWeight:700,color:"#c4b5fd",cursor:"pointer"}}>
                ✅ {Object.values(secili).filter(Boolean).length} Kodu Uygula
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
