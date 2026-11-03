# Mi tienda

Inventario, etiquetas con código de barras y ventas para una tienda de ropa americana (pacas, calzado y bisutería). Hecha para usarse desde el celular o la tablet, con letra grande y pasos simples.

## Qué hay en este proyecto

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Toda la aplicación en un solo archivo. Funciona igual dentro de Claude y publicada en GitHub Pages con Supabase. |
| `catalogo.html` | Catálogo para los clientes: solo las prendas a la venta (foto, talla, color, precio), sin costos ni ganancias. |
| `conectar.html` | Donde se entra con el usuario de la tienda al conectar Claude (conector MCP). |
| `pedido.html` | Lo que ve el cliente con el enlace de su pedido: sus prendas, sus abonos y cuánto le falta. |
| `supabase/migrations/…_mi_tienda.sql` | Tablas, seguridad (solo usuarios con sesión), códigos de etiqueta sin repetir y tiempo real. |
| `supabase/migrations/…_tiendas.sql` | Catálogo de tiendas donde se compra y la vista `rentabilidad_por_tienda`. |
| `supabase/migrations/…_clientes.sql` | Clientes (nombre y teléfono; el teléfono es la llave), el cliente de cada venta y permisos para borrar. |
| `supabase/migrations/…_catalogo.sql` | WhatsApp de la tienda y las dos funciones públicas que usa el catálogo. |
| `supabase/migrations/…_apartados.sql` | Apartados y sus abonos, prendas apartadas y la función pública `pedido_ver` del enlace del cliente. |
| `supabase/migrations/…_ofertas.sql` | Descuento (porcentaje) de cada prenda y el catálogo con el precio de oferta. |
| `supabase/migrations/…_pedido_retiros.sql` | El enlace del cliente muestra qué prendas del pedido ya se llevó. |
| `supabase/migrations/…_fotos_calidad.sql` | Fotos en buena calidad: almacenamiento «fotos» y la dirección de la foto grande de cada prenda. |
| `supabase/functions/clasificar/` | Reconoce la prenda de la foto con Claude: tipo y color con su probabilidad, nombre y precio sugerido. |
| `supabase/functions/mcp/` | Conector de Claude (servidor MCP) para preguntarle a Claude por las ventas, prendas, pedidos y clientes, y corregir datos de prendas. |
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

## Pedidos (apartados)
Para hacer un pedido: en **Vender** escanee las prendas, elija la clienta y toque **Hacer un pedido con estas prendas**. Ponga el precio del pedido y, si le dio algo, el primer abono. Las prendas salen del inventario y del catálogo.

En **Pedidos** están todos, con lo que ha pagado cada clienta. En cada pedido puede registrar abonos (monto y fecha), quitar prendas, cambiar el precio, imprimir la **etiqueta del pedido** (nombre y teléfono de la clienta, número de pedido y cuántas prendas) y mandarle por WhatsApp cuánto lleva con el enlace a su pedido (`…/pedido.html?c=…`, solo en la versión con Supabase).

Al escanear la etiqueta del pedido (código `P0012`) se abre el pedido. Cuando la clienta llega al porcentaje de **Ajustes** (50 % al inicio), la tienda avisa que ya se puede entregar. Al **entregar**, las prendas pasan a vendidas y el precio del pedido se reparte entre ellas; si todavía debe algo, se siguen anotando sus abonos. Al **cancelar**, las prendas vuelven a la tienda.

La clienta también se puede llevar **una prenda suelta** mientras sigue pagando: en el pedido, toque **Entregar** en esa prenda. Se puede cuando lo pagado cubre el porcentaje de Ajustes de lo que valen las prendas que se lleva (cada prenda vale su parte del precio del pedido, según su precio de etiqueta). Las demás siguen apartadas, el pedido sigue con el mismo monto y se ve cuáles ya se llevó, en la tienda y en el enlace del cliente.

## Ofertas
En **Prendas** toque **Poner prendas en oferta**, toque las prendas (o **Elegir las que se ven**, después de filtrar) y luego **Ponerles descuento**: 10, 15, 20, 25, 30, 40, 50 % u otro. También se puede desde cada prenda con **Poner en oferta**.

El precio de oferta se redondea a los ₡100. En la tienda y en el catálogo se ve el precio de antes tachado, el de oferta y el porcentaje; el catálogo tiene el botón **Ofertas**. Al vender o hacer un pedido se cobra el de oferta. Para terminar la oferta: **Cambiar o quitar la oferta**. La etiqueta impresa sigue con el precio normal.

## Preguntarle a Claude por la tienda (conector MCP)
Desde claude.ai (o la app de Claude en el celular) se le puede preguntar, por ejemplo: «¿cuánto vendí esta semana y cuánto gané?», «¿quién me debe en pedidos?», «¿qué vestidos talla M tengo?», «¿de cuál tienda me conviene comprar?». El conector también puede **corregir prendas mal registradas** (nombre, tipo, talla, color, para quién y precio de etiqueta) y **ver sus fotos** para revisar si cuadran; Claude pregunta antes de cambiar algo. No puede vender, borrar ni tocar pedidos o abonos. Si cambia el nombre, la talla o el precio, la etiqueta queda como «sin imprimir» para reimprimirla.

Una sola vez:
1. En GitHub → Settings → Secrets and variables → Actions debe estar **`MCP_CLAVE`** (una clave larga al azar, por ejemplo de `openssl rand -hex 24`). Con ella se firman los permisos; nadie la tiene que escribir.
2. En claude.ai → Ajustes → Conectores → **Agregar conector personalizado**: nombre «Mi tienda» y la dirección `https://<proyecto>.supabase.co/functions/v1/mcp` (sin nada más al final).
3. Al conectarlo, Claude abre `conectar.html`: se entra con el **mismo usuario y contraseña de la tienda**. Claude recibe un permiso que dura una hora y se renueva solo.

Si borra o bloquea un usuario en Supabase, ese Claude pierde el acceso en menos de una hora. Si cambia `MCP_CLAVE`, todos tienen que volver a conectar.

## Fotos
Cada foto se guarda en dos tamaños: una miniatura liviana dentro de la prenda (para que las listas carguen rápido) y la foto en buena calidad (hasta 1600 px) en el almacenamiento «fotos» de Supabase, que se ve en el detalle de la prenda, en el catálogo al tocar la foto, y la usa Claude con el conector. Las fotos que se subieron antes de este cambio solo tienen la miniatura: para verlas mejor, cámbielas.

En el detalle de cada prenda: **Cambiar la foto** (tomar una nueva o elegir de la galería), **Girar** y **Quitar la foto**.
