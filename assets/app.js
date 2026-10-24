// Parkings APER — vérificateur d'obligation (données IGN BD TOPO + BAN)
// Aucune donnée personnelle collectée. Tout le calcul est fait dans le navigateur.

const DEPT_NAMES = window.DEPT_NAMES || {};

function deptFromInsee(code) {
  if (!code) return null;
  if (code.startsWith('97')) return code.slice(0, 3);
  return code.slice(0, 2);
}

function hav(a, b) {
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b[1] - a[1]), dLon = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function money(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' €'; }
function num(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(n)); }

function computeFromSurface(s, dept) {
  const seuil = dept === '974' ? 1000 : (dept === '973' ? 2500 : 1500);
  const assujetti = s >= seuil;
  const grande = s >= 10000;
  const ombrage = s * 0.5;
  const pvMin = s * 0.175;          // mixte : 35 % de la moitié (loi du 26/11/2025)
  const pvMax = s * 0.5;            // tout en ombrières
  const kwcMin = pvMin * 0.2;       // 200 Wc/m² couvert
  const kwcMax = pvMax * 0.2;
  const prodMin = kwcMin * 1100;    // kWh/an, moyenne France prudente
  const prodMax = kwcMax * 1100;
  return {
    s, seuil, assujetti, grande, ombrage, pvMin, pvMax,
    kwcMin, kwcMax, prodMin, prodMax,
    echeance: grande ? '1er juillet 2026' : '1er juillet 2028',
    amende: grande ? 40000 : 20000
  };
}

function renderResult(r, label, parking) {
  const el = document.getElementById('result');
  if (!r.assujetti) {
    el.innerHTML = `<div class="card">
      <h3>${label}</h3>
      <p><b>${num(r.s)} m²</b> — sous le seuil de ${num(r.seuil)} m² applicable${
        r.seuil === 1500 ? ' en métropole' : ' dans ce département'}.</p>
      <p class="muted">L'obligation d'ombrage de l'article 40 de la loi APER ne s'applique pas
      à ce parc au titre des parcs existants. Attention : d'autres obligations peuvent viser les
      parcs neufs ou rénovés (art. L.111-19-1 du code de l'urbanisme, dès 500 m²).</p>
    </div>`;
    return;
  }
  el.innerHTML = `<div class="card">
    <h3>${label}</h3>
    <p style="margin-top:0">Parc de <b>${num(r.s)} m²</b> : au-dessus du seuil de
    ${num(r.seuil)} m². Il entre dans le champ de l'article 40 de la loi APER
    ${r.grande ? '<span class="pill red">échéance dépassée depuis le 1er juillet 2026</span>'
                : '<span class="pill amber">échéance 1er juillet 2028</span>'}.</p>
    <div class="grid2">
      <div class="kv"><span>Surface à ombrager (50 %)</span><b>${num(r.ombrage)} m²</b></div>
      <div class="kv"><span>Échéance de principe</span><b>${r.echeance}</b></div>
      <div class="kv"><span>Ombrières PV a minima</span><b>${num(r.pvMin)} m²</b></div>
      <div class="kv"><span>Sanction annuelle max.</span><b>${money(r.amende)}</b></div>
      <div class="kv"><span>Puissance PV estimée</span><b>${num(r.kwcMin)} – ${num(r.kwcMax)} kWc</b></div>
      <div class="kv"><span>Production estimée</span><b>${num(r.prodMin / 1000)} – ${num(r.prodMax / 1000)} MWh/an</b></div>
    </div>
    <div class="warn"><b>Ce que ce calcul ne dit pas.</b> Le recensement IGN donne la surface du parc,
    pas son statut : un parc déjà couvert, déjà ombragé par des arbres sur 50 % de sa surface, ou
    couvert par une exonération (contraintes techniques, coût disproportionné, suppression programmée)
    peut ne pas avoir à s'équiper. La surface exacte au sens du décret exclut aussi espaces verts et
    voiries poids lourds.</div>
    <p style="margin-bottom:0"><button class="btn ghost" onclick="window.print()">Imprimer / enregistrer en PDF cette fiche</button>
    <a class="btn amber" style="margin-left:8px" href="installateurs.html#devis">Je suis installateur →</a></p>
    <p class="note">Estimations : 200 Wc/m² couvert, 1 100 kWh/kWc/an. Le minimum PV correspond au
    scénario mixte autorisé depuis la loi du 26 novembre 2025 (35 % de la moitié à ombrager).</p>
  </div>`;
}

async function searchAddress(q) {
  const u = 'https://api-adresse.data.gouv.fr/search/?limit=5&q=' + encodeURIComponent(q);
  const r = await fetch(u);
  const j = await r.json();
  return j.features || [];
}

let cache = {};
async function loadDept(d) {
  if (cache[d]) return cache[d];
  const r = await fetch(`data/dep/${d}.json`);
  if (!r.ok) throw new Error('no data');
  const rows = await r.json();
  cache[d] = rows.map(x => ({...x, p: [x.lon, x.lat]}));
  return cache[d];
}

async function checkAddress(feature) {
  const out = document.getElementById('result');
  const coords = feature.geometry.coordinates;
  const citycode = feature.properties.citycode;
  const d = deptFromInsee(citycode);
  out.innerHTML = '<div class="card"><p class="muted">Recherche des parcs de stationnement autour de cette adresse…</p></div>';
  let rows = [];
  try { rows = await loadDept(d); } catch (e) { rows = []; }
  const near = rows
    .map(r => ({...r, dist: hav(coords, r.p)}))
    .filter(r => r.dist < 900)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 6);
  if (!near.length) {
    out.innerHTML = `<div class="card"><h3>${feature.properties.label}</h3>
      <p>Aucun parc de stationnement extérieur de plus de 1 500 m² recensé par l'IGN à moins de 900 m
      de cette adresse.</p>
      <p class="muted small">Le recensement IGN couvre les parcs existants cartographiés ; un petit parc
      privé peut ne pas y figurer. Si vous connaissez la surface, utilisez le calcul manuel ci-dessous.</p></div>`;
    return;
  }
  const opts = near.map((p, i) =>
    `<tr><td>${i + 1}. ${p.c || ''}<br><span class="small muted">${num(p.dist)} m de l'adresse</span></td>
     <td class="num"><b>${num(p.s)} m²</b></td>
     <td class="num">${p.s >= 10000 ? '≥ 10 000 m²' : '1 500 – 10 000 m²'}</td>
     <td class="num"><a href="#" data-i="${i}" class="pick">calculer</a></td></tr>`).join('');
  out.innerHTML = `<div class="card"><h3>${feature.properties.label}</h3>
    <p style="margin-top:0">Parcs de stationnement extérieurs recensés à proximité :</p>
    <table><thead><tr><th>Parc</th><th class="num">Surface</th><th class="num">Tranche</th><th></th></tr></thead>
    <tbody>${opts}</tbody></table>
    <p class="small muted">Sélectionnez le parc correspondant au vôtre. La surface provient de la couche
    IGN « parkings de plus de 500 m² » (BD TOPO).</p></div>`;
  out.querySelectorAll('.pick').forEach(a => a.addEventListener('click', ev => {
    ev.preventDefault();
    const p = near[+a.dataset.i];
    renderResult(computeFromSurface(p.s, d), `${p.c || feature.properties.city} — ${num(p.s)} m²`, p);
  }));
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('addr');
  const list = document.getElementById('suggestions');
  const manual = document.getElementById('manual-surface');
  const manualBtn = document.getElementById('manual-go');
  let timer = null;

  if (input) {
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 4) { list.innerHTML = ''; return; }
      timer = setTimeout(async () => {
        try {
          const feats = await searchAddress(q);
          list.innerHTML = feats.map((f, i) =>
            `<li data-i="${i}">${f.properties.label}</li>`).join('');
          list.querySelectorAll('li').forEach(li => li.addEventListener('click', () => {
            input.value = li.textContent;
            list.innerHTML = '';
            checkAddress(feats[+li.dataset.i]);
          }));
        } catch (e) { list.innerHTML = ''; }
      }, 300);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = list.querySelector('li');
        if (first) first.click();
      }
    });
  }

  if (manualBtn) manualBtn.addEventListener('click', () => {
    const s = parseFloat((manual.value || '').replace(/\s/g, '').replace(',', '.'));
    if (!s || s <= 0) { manual.focus(); return; }
    renderResult(computeFromSurface(s, '75'), `Parking de ${num(s)} m² (surface saisie)`);
  });
});
