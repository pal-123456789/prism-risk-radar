/*
 * PRism landing — hero WebGL prism + scroll caption engine + reveals.
 * Externalized from landing.html so the page runs under a strict CSP
 * (script-src 'self'; no inline). Zero dependencies, zero network.
 */
(function(){
  "use strict";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- scroll → hero progress + captions + nav ----------
  var hero = document.getElementById("top");
  var caps = Array.prototype.slice.call(document.querySelectorAll(".cap"));
  var nav  = document.getElementById("nav");
  var hint = document.getElementById("hint");
  var progress = 0;         // 0..1 across the hero track
  var targetProgress = 0;

  function computeScroll(){
    var rect = hero.getBoundingClientRect();
    var total = hero.offsetHeight - window.innerHeight;
    var scrolled = Math.min(Math.max(-rect.top, 0), total);
    targetProgress = total > 0 ? scrolled / total : 0;

    // captions
    for (var i=0;i<caps.length;i++){
      var a = parseFloat(caps[i].getAttribute("data-in"));
      var b = parseFloat(caps[i].getAttribute("data-out"));
      var on = targetProgress >= a && targetProgress < b;
      caps[i].classList.toggle("on", on);
    }
    // nav appears once you're past the film
    var past = rect.bottom <= window.innerHeight + 4;
    nav.classList.toggle("show", past);
    if (hint) hint.style.opacity = targetProgress > 0.03 ? "0" : ".8";
  }
  window.addEventListener("scroll", computeScroll, {passive:true});
  window.addEventListener("resize", computeScroll);

  // ---------- reveal-on-scroll for the brand page ----------
  var revs = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  if ("IntersectionObserver" in window){
    var io = new IntersectionObserver(function(es){
      es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add("in"); io.unobserve(e.target);} });
    }, {threshold:0.16});
    revs.forEach(function(el){ io.observe(el); });
  } else { revs.forEach(function(el){ el.classList.add("in"); }); }

  // ---------- sample cards (verified engine outputs) ----------
  var SAMPLES = [
    {label:"Leaked credentials", score:98, tier:"Critical", c:"--sev-danger"},
    {label:"Risky security feature", score:84, tier:"Critical", c:"--sev-danger"},
    {label:"Trojan source", score:82, tier:"Critical", c:"--sev-danger"},
    {label:"Tests dropped", score:61, tier:"High", c:"--sev-warn"},
    {label:"Large refactor", score:52, tier:"Moderate", c:"--sev-notice"},
    {label:"Clean change", score:22, tier:"Low", c:"--sev-safe"}
  ];
  var host = document.getElementById("samples");
  if (host){
    SAMPLES.forEach(function(s){
      var d = document.createElement("div");
      d.className = "scard";
      d.style.borderLeftColor = "var("+s.c+")";
      d.innerHTML = '<div class="score">'+s.score+'</div>'+
        '<div class="tier" style="color:var('+s.c+')">'+s.tier+'</div>'+
        '<div class="lbl">'+s.label+'</div>';
      host.appendChild(d);
    });
  }

  // ---------- WebGL prism (zero-dependency, hand-written shader) ----------
  var canvas = document.getElementById("prism");
  var fallback = document.getElementById("fallback");
  var mouse = {x:0.5, y:0.5}, mtarget = {x:0.5, y:0.5};
  window.addEventListener("pointermove", function(e){
    mtarget.x = e.clientX / window.innerWidth;
    mtarget.y = e.clientY / window.innerHeight;
  }, {passive:true});

  function useFallback(){
    if (canvas) canvas.style.display = "none";
    if (fallback) fallback.style.display = "block";
  }

  var VERT = [
    "attribute vec2 aPos;",
    "void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }"
  ].join("\n");

  var FRAG = [
    "precision highp float;",
    "uniform vec2  uRes;",
    "uniform float uTime;",
    "uniform float uScroll;",
    "uniform vec2  uMouse;",
    "",
    "// severity ramp: safe -> notice -> warn -> danger",
    "vec3 ramp(float t){",
    "  t = clamp(t, 0.0, 1.0);",
    "  vec3 safe   = vec3(0.227, 0.780, 0.541);",
    "  vec3 notice = vec3(0.906, 0.765, 0.294);",
    "  vec3 warn   = vec3(0.941, 0.525, 0.235);",
    "  vec3 danger = vec3(0.941, 0.333, 0.373);",
    "  if (t < 0.3333) return mix(safe, notice, t/0.3333);",
    "  if (t < 0.6666) return mix(notice, warn, (t-0.3333)/0.3333);",
    "  return mix(warn, danger, (t-0.6666)/0.3334);",
    "}",
    "",
    "mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }",
    "",
    "// signed distance to an equilateral triangle (iq), radius r",
    "float sdTri(vec2 p, float r){",
    "  const float k = 1.7320508;",   // sqrt(3)
    "  p.x = abs(p.x) - r;",
    "  p.y = p.y + r/k;",
    "  if (p.x + k*p.y > 0.0) p = vec2(p.x - k*p.y, -k*p.x - p.y)/2.0;",
    "  p.x -= clamp(p.x, -2.0*r, 0.0);",
    "  return -length(p)*sign(p.y);",
    "}",
    "",
    "// distance from point p to segment a-b",
    "float sdSeg(vec2 p, vec2 a, vec2 b){",
    "  vec2 pa = p-a, ba = b-a;",
    "  float h = clamp(dot(pa,ba)/dot(ba,ba), 0.0, 1.0);",
    "  return length(pa - ba*h);",
    "}",
    "",
    "void main(){",
    "  vec2 uv = (gl_FragCoord.xy - 0.5*uRes.xy) / uRes.y;", // aspect-correct, centered
    "  float par = (uMouse.x-0.5)*0.10;",                    // subtle mouse parallax
    "  vec2 c = vec2(par, (uMouse.y-0.5)*-0.06);",
    "  vec3 col = vec3(0.0);",
    "",
    "  // background: faint drifting caustics on near-black",
    "  float bg = 0.02 + 0.012*sin(uv.x*6.0 + uTime*0.3) * cos(uv.y*5.0 - uTime*0.22);",
    "  col += vec3(0.02,0.028,0.045) + bg;",
    "",
    "  // --- input beam: white light entering from the left ---",
    "  float scr = clamp(uScroll, 0.0, 1.0);",
    "  vec2 entry = c + vec2(-0.34, 0.0);",
    "  float beamIn = sdSeg(uv, vec2(-1.4, entry.y*0.2 - 0.02), entry);",
    "  col += vec3(1.0) * (0.006 / (beamIn*beamIn + 0.0004)) * 0.5;",
    "",
    "  // --- the prism itself ---",
    "  vec2 pp = (uv - c);",
    "  pp *= rot(-0.5 + scr*2.4 + uTime*0.05);",             // rotates as you scroll
    "  float d = sdTri(pp, 0.34);",
    "  float edge = abs(d);",
    "  // glass body: dark, with an internal spectrum that grows with scroll",
    "  if (d < 0.0){",
    "    float g = clamp((pp.x/0.34)*0.5 + 0.5, 0.0, 1.0);",
    "    vec3 inner = ramp(g);",
    "    float fill = 0.10 + 0.32*scr;",
    "    col = mix(col, inner*0.55 + 0.04, fill);",
    "  }",
    "  // crisp refracting edges",
    "  col += vec3(0.9,0.93,1.0) * smoothstep(0.010, 0.0, edge) * 0.9;",
    "  col += vec3(0.6,0.7,1.0)  * (0.0015 / (edge*edge + 0.00006)) * 0.35;",
    "",
    "  // --- dispersed output fan: white splits into the risk spectrum ---",
    "  vec2 apex = c + vec2(0.16, -0.02);",                  // where the fan originates
    "  float spread = 0.18 + scr*0.62;",                     // fan widens with scroll
    "  float bright = 0.10 + scr*0.9;",
    "  const int N = 7;",
    "  for (int i=0;i<N;i++){",
    "    float f = float(i)/float(N-1);",                    // 0..1 across the fan
    "    float ang = mix(-spread, spread, f) + 0.02*sin(uTime*0.6 + f*6.28);",
    "    vec2 dir = vec2(cos(ang), sin(ang));",
    "    vec2 endp = apex + dir*1.6;",
    "    float b = sdSeg(uv, apex, endp);",
    "    vec3 rc = ramp(f);",
    "    // only light to the RIGHT of the prism (past the apex)",
    "    float side = smoothstep(-0.02, 0.10, uv.x - apex.x);",
    "    col += rc * (0.0016 / (b*b + 0.0003)) * bright * side;",
    "  }",
    "",
    "  // bloom lift + filmic-ish tonemap",
    "  col = col / (col + vec3(0.72));",
    "  col = pow(col, vec3(0.86));",
    "  // vignette",
    "  float v = smoothstep(1.25, 0.35, length(uv));",
    "  col *= 0.55 + 0.45*v;",
    "  gl_FragColor = vec4(col, 1.0);",
    "}"
  ].join("\n");

  function compile(gl, type, src){
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
      // eslint-disable-next-line no-console
      console.warn("PRism shader:", gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  function initGL(){
    if (!canvas) return false;
    var gl = null;
    try { gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl"); }
    catch(e){ return false; }
    if (!gl) return false;

    var vs = compile(gl, gl.VERTEX_SHADER, VERT);
    var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    var prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)){
      console.warn("PRism link:", gl.getProgramInfoLog(prog));
      return false;
    }
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    var uRes = gl.getUniformLocation(prog, "uRes");
    var uTime = gl.getUniformLocation(prog, "uTime");
    var uScroll = gl.getUniformLocation(prog, "uScroll");
    var uMouse = gl.getUniformLocation(prog, "uMouse");

    function resize(){
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.floor(window.innerWidth * dpr);
      var h = Math.floor(window.innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h){ canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    window.addEventListener("resize", resize);
    resize();

    var start = performance.now();
    function frame(now){
      // ease scroll + mouse for smoothness
      progress += (targetProgress - progress) * 0.08;
      mouse.x += (mtarget.x - mouse.x) * 0.06;
      mouse.y += (mtarget.y - mouse.y) * 0.06;
      var t = reduce ? 0.0 : (now - start) / 1000.0;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, t);
      gl.uniform1f(uScroll, progress);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return true;
  }

  // boot
  computeScroll();
  if (!initGL()) useFallback();
})();
