/* Compila la app y genera index.html.
 *
 * Por qué existe: antes el navegador bajaba Babel (2,5 MB) y compilaba los
 * 128 KB de JSX en CADA apertura. Medido contra producción, eso son ~1.200 ms
 * en una computadora — el 60% del arranque — y tres a cinco veces más en un
 * celular de gama baja.
 *
 * Cómo usarlo:
 *     node build.js
 *
 * Qué toca:
 *     src/app.jsx              <- el código, ACÁ se edita
 *     src/index.template.html  <- el HTML alrededor
 *     index.html               <- GENERADO, no editar a mano
 *
 * No necesita npm install: la primera vez baja Babel del mismo CDN que usaba
 * la app y lo deja cacheado en .babel-cache.js (ignorado por git).
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RAIZ = __dirname;
const FUENTE = path.join(RAIZ, "src", "app.jsx");
const TEMPLATE = path.join(RAIZ, "src", "index.template.html");
const SALIDA = path.join(RAIZ, "index.html");
const CACHE = path.join(RAIZ, ".babel-cache.js");
const BABEL_URL = "https://unpkg.com/@babel/standalone@7.23.10/babel.min.js";

async function cargarBabel() {
  let src;
  if (fs.existsSync(CACHE)) {
    src = fs.readFileSync(CACHE, "utf8");
  } else {
    process.stdout.write("bajando Babel (solo la primera vez)... ");
    const res = await fetch(BABEL_URL);
    if (!res.ok) throw new Error("no se pudo bajar Babel: HTTP " + res.status);
    src = await res.text();
    fs.writeFileSync(CACHE, src);
    console.log("ok");
  }
  const sandbox = { self: {}, window: {}, navigator: { userAgent: "node" } };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const Babel = sandbox.Babel || sandbox.window.Babel;
  if (!Babel) throw new Error("Babel no quedó expuesto");
  return Babel;
}

(async () => {
  const Babel = await cargarBabel();
  const jsx = fs.readFileSync(FUENTE, "utf8");
  const template = fs.readFileSync(TEMPLATE, "utf8");

  if (!template.includes("/*__APP__*/")) {
    throw new Error("el template perdió el marcador /*__APP__*/");
  }

  // Solo el preset "react": transforma el JSX y deja el resto del JavaScript
  // como está. NO se usa "env" a propósito: al apuntar a ES5 convertiría los
  // async/await en generadores que necesitan regeneratorRuntime, que no está
  // cargado, y la app se rompería. Los navegadores de los choferes soportan
  // sintaxis moderna sin problema.
  let compilado;
  try {
    compilado = Babel.transform(jsx, { presets: ["react"], filename: "app.jsx" }).code;
  } catch (e) {
    console.error("\nFALLA DE COMPILACIÓN:\n" + e.message);
    process.exit(1);
  }

  // Que el resultado sea JavaScript válido antes de escribirlo.
  try {
    new vm.Script(compilado, { filename: "app.compilado.js" });
  } catch (e) {
    console.error("\nEl compilado no parsea:\n" + e.message);
    process.exit(1);
  }

  // El código va inline dentro de un <script>. Si alguna vez apareciera la
  // secuencia </script> dentro de un texto, cerraría la etiqueta antes de tiempo
  // y rompería la página entera. Se corta acá en vez de publicar algo roto.
  if (/<\/script/i.test(compilado)) {
    console.error(
      "\nFALLA: el código contiene '</script>', que cortaría la etiqueta y rompería el HTML.\n" +
      "Partilo en el fuente, por ejemplo como '<\\/scr' + 'ipt>'."
    );
    process.exit(1);
  }

  const aviso =
    "<!--\n" +
    "  ARCHIVO GENERADO POR build.js — NO EDITAR A MANO.\n" +
    "  El código se edita en src/app.jsx y después se corre:  node build.js\n" +
    "  Cualquier cambio hecho acá se pierde en la próxima compilación.\n" +
    "-->\n";

  const salida = aviso + template.replace("/*__APP__*/", () => compilado);

  // node build.js --check  →  no escribe: solo avisa si index.html quedó
  // desincronizado de src/app.jsx (por ejemplo si alguien lo editó a mano o si
  // se olvidaron de compilar antes de pushear).
  if (process.argv.includes("--check")) {
    const actual = fs.existsSync(SALIDA) ? fs.readFileSync(SALIDA, "utf8") : "";
    const norm = (s) => s.replace(/\r\n/g, "\n");
    if (norm(actual) === norm(salida)) {
      console.log("index.html está al día con src/app.jsx");
      return;
    }
    console.error("index.html NO coincide con src/app.jsx. Corré: node build.js");
    process.exit(1);
  }

  fs.writeFileSync(SALIDA, salida);

  const kb = (n) => Math.round(n / 1024) + " KB";
  console.log("compilado   " + kb(jsx.length) + " de JSX  ->  " + kb(compilado.length) + " de JS");
  console.log("escrito     index.html (" + kb(salida.length) + ")");
  console.log("recordá:    el navegador ya no baja ni ejecuta Babel");
})();
