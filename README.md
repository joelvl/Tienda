# Mi tienda

Inventario, etiquetas con código de barras y ventas para una tienda de ropa americana (pacas, calzado y bisutería). Hecha para usarse desde el celular o la tablet, con letra grande y pasos simples.

## Qué hay en este proyecto

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Toda la aplicación en un solo archivo. Funciona igual dentro de Claude y publicada en GitHub Pages con Supabase. |
| `catalogo.html` | Catálogo para los clientes: solo las prendas a la venta (foto, talla, color, precio), sin costos ni ganancias. |
| `supabase/migrations/…_mi_tienda.sql` | Tablas, seguridad (solo usuarios con sesión), códigos de etiqueta sin repetir y tiempo real. |
| `supabase/migrations/…_tiendas.sql` | Catálogo de tiendas donde se compra y la vista `rentabilidad_por_tienda`. |
| `supabase/migrations/…_clientes.sql` | Clientes (nombre y teléfono; el teléfono es la llave), el cliente de cada venta y permisos para borrar. |
| `supabase/migrations/…_catalogo.sql` | WhatsApp de la tienda y las dos funciones públicas que usa el catálogo. |
| `supabase/functions/clasificar/` | Reconoce la prenda de la foto con Claude: tipo y color con su probabilidad, nombre y precio sugerido. |
| `.github/workflows/desplegar.yml` | En cada cambio a `main`: actualiza la base de datos, publica la función de IA y publica la página. |
| `scripts/preparar-sitio.mjs` | Lo usa GitHub Actions para insertar la configuración de Supabase en la página. |
| `scripts/crear-usuario.mjs` | Opcional: crea usuarios desde la terminal. |
| `scripts/cargar-fotos.mjs` | Opcional: sube una carpeta de fotos como prendas de una compra; la IA saca tipo, color, nombre, talla y precio de cada foto. |
| `publico/` | Íconos y manifiesto para instalar la tienda en la pantalla de inicio del celular. |

## Puesta en marcha (se hace una sola vez)

### 1. Supabase
1. Cree un proyecto en [supabase.com](https://supabase.com). Guarde la **contraseña de la base de datos**.
2. Anote tres datos del proyecto: la **URL** (`https://xxxx.supabase.co`), la **llave publicable** (`sb_publishable_…`) y el **Project ref** (las letras de la URL). Están en la configuración del proyecto, en *API Keys* y *Data API*. Si su proyecto solo muestra la llave *anon*, sirve igual.
3. En **Authentication**, en la configuración del proveedor **Email**:
   - desactive el registro de usuarios nuevos (*Allow new users to sign up*), para que solo entren los usuarios que usted cree;
   - desactive la confirmación por correo (*Confirm email*).
4. Cree el usuario de su mamá en **Authentication → Users → Add user**: correo `mama@mitienda.app`, una contraseña, y marque *Auto Confirm User*. Ella entra escribiendo solo **mama** y su contraseña.
   - Puede crear los usuarios que quiera (por ejemplo `carlos@mitienda.app`). Todos ven la misma tienda.
5. Cree un **token de acceso** en su cuenta de Supabase (*Account → Access Tokens*).

### 2. Llave de Claude (para reconocer las fotos)
Cree una llave en [console.anthropic.com](https://console.anthropic.com) → *API Keys*. Si no la pone, la tienda funciona igual, pero sin reconocimiento automático.

### 3. GitHub
1. Cree un repositorio y suba esta carpeta.
2. En **Settings → Pages**, elija *Source: GitHub Actions*.
3. En **Settings → Secrets and variables → Actions → New repository secret**, agregue:

| Secreto | Valor |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | El token de acceso del paso 1.5 |
| `SUPABASE_PROJECT_REF` | El Project ref |
| `SUPABASE_DB_PASSWORD` | La contraseña de la base de datos |
| `SUPABASE_URL` | La URL del proyecto |
| `SUPABASE_PUBLISHABLE_KEY` | La llave publicable `sb_publishable_…` (o la *anon* en proyectos viejos) |
| `ANTHROPIC_API_KEY` | La llave de Claude |

   Opcional: una **variable** (no secreto) `DOMINIO_USUARIOS` si quiere otro dominio para los usuarios en lugar de `mitienda.app`.

4. Suba un cambio a `main` (o en **Actions → Desplegar Mi tienda → Run workflow**). Al terminar, el enlace de la tienda aparece en el paso *Página web*.

### 4. En el celular de su mamá
Abra el enlace en Chrome (Android) o Safari (iPhone) y use **Agregar a pantalla de inicio**. Queda como una app. La sesión se mantiene abierta en ese aparato hasta que cierre sesión en Ajustes.

## Pasar los datos de la versión de Claude
En la versión de Claude: **Ajustes → Descargar respaldo completo**. En la versión nueva: **Ajustes → Cargar un respaldo**. Se cargan compras, prendas (con foto), ventas y códigos; los códigos nuevos siguen después del último.

## Tiendas y rentabilidad
Cada compra puede tener la tienda donde se compró. En **Compras → Tiendas** se comparan: cuánto se vende cada prenda por cada ₡1 000 que costó, cuánto se invirtió, vendió y ganó, y cuánto tardan en venderse.

Una compra que no dice cuántas prendas trae queda **abierta**: el costo por prenda se recalcula con cada prenda nueva. Mientras esté abierta no cuenta para comparar tiendas. Al terminar de registrar sus prendas se cierra con **Ya registré todas**, y desde ahí su costo queda fijo.

Para reportes, en Supabase se puede consultar:
```sql
select * from rentabilidad_por_tienda order by vende_en_por_cada_1000 desc nulls last;
```

## Costos aproximados
- **Reconocimiento de fotos**: con el modo rápido (Claude Haiku 4.5, a $1 por millón de tokens de entrada y $5 por millón de salida), cada foto cuesta alrededor de **$0.003 USD**: unos **$3 USD por cada 1 000 fotos**. El modo "más preciso" (Claude Sonnet) cuesta varias veces más. Es un estimado; revise los precios vigentes de Anthropic.
- **GitHub Pages**: gratis con repositorio público. El repositorio no guarda llaves: todo va en *Secrets*.
- **Supabase**: el plan gratuito suele alcanzar para una tienda; revise sus límites actuales.

## Cambiar el modelo de IA
En Supabase, en los secretos de las Edge Functions, puede definir `MODELO_RAPIDO` y `MODELO_PRECISO` con el nombre del modelo que quiera usar. Si prefiere otro proveedor, todo el llamado está en `supabase/functions/clasificar/index.ts`: la página solo espera de vuelta el mismo JSON (`tipos`, `colores`, `descripcion`, `talla`, `marca`, `precio`).

## Seguridad
- Solo entran los usuarios que usted crea (registro cerrado). Las tablas tienen RLS: sin sesión no se ve nada.
- La llave publicable es pública por diseño; la protección la dan RLS y el inicio de sesión.
- La función de IA rechaza llamadas sin sesión, para que nadie gaste su llave de Claude.
- El escáner en vivo con la cámara necesita HTTPS (GitHub Pages ya lo tiene).

## Crear usuarios desde la terminal (opcional)
```bash
SUPABASE_URL=https://xxxx.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/crear-usuario.mjs mama SuClave123
```
La llave *service_role* da acceso total: úsela solo en su computadora y nunca la suba a GitHub.

## Clientes
En la pestaña **Clientes** se ve cuánto ha comprado cada cliente (ordenados por los que más compran o por nombre), y al tocar uno, cada compra con su fecha, lo que se llevó y el total, más un botón para escribirle por WhatsApp.

El teléfono es lo que identifica al cliente: no se repite. Se pueden agregar a mano, al guardar una venta, o desde los contactos del teléfono (**Agregar desde mis contactos** permite elegir varios a la vez; se toma el nombre y el número, y se quita el +506). Elegir contactos funciona en Chrome para Android; en iPhone y en el navegador propio de Huawei el botón no aparece y se escriben a mano.

Al borrar un cliente sus compras se quedan como vendidas, pero sin cliente.

## Catálogo para clientes
En **Prendas** o **Clientes** toque **Compartir catálogo** y mándelo por WhatsApp; también desde la ficha de cada cliente con **Enviarle el catálogo por WhatsApp**. El enlace es `…/catalogo.html` del mismo sitio.

Los clientes no necesitan usuario. El catálogo muestra solo las prendas que están en la tienda (las vendidas desaparecen solas) con foto, talla, color, precio y código. No se ve el costo, la compra, la tienda donde se compró, las ventas ni los clientes, y desde el catálogo no se puede cambiar nada.

Ponga el **WhatsApp de la tienda** en **Ajustes**: así cada prenda del catálogo tiene un botón **La quiero** que le escribe a ese número con el nombre, la talla, el precio y el código de la prenda.

El catálogo solo existe en la versión publicada con Supabase.
