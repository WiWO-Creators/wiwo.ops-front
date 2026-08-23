# Copia local para revisión con Docker

Esta copia ejecuta el frontend construido desde la rama actual junto con los servicios necesarios para autenticación, archivos, búsqueda y datos. No depende del login de Google: usa cuentas locales y un workspace restaurado desde `tests/sanity-ws`.

## Cómo funciona

El flujo tiene tres partes:

1. Rush compila, empaqueta y genera los bundles del repositorio.
2. `rush docker:build` crea las imágenes locales, incluida `hardcoreeng/front`.
3. `tests/prepare.sh` reinicia el proyecto Docker Compose `sanity`, espera que Elasticsearch responda, crea las cuentas locales y restaura el workspace `sanity-ws`.

`prepare.sh` ejecuta `docker compose down --volumes` únicamente sobre el proyecto `sanity`. Por eso cada preparación elimina los datos anteriores de esa copia y vuelve a cargar el snapshot conocido. No afecta otros proyectos Compose con otro nombre.

## Requisitos

- Docker con Compose disponible.
- Dependencias del monorepo instaladas mediante Rush.
- Puertos definidos en `tests/docker-compose.yaml` libres, especialmente `8083`, `3003` y `3334`.

## Crear la copia

Desde la raíz del repositorio:

```bash
rush install
rush build
rush bundle
rush docker:build
cd tests
./prepare.sh
```

La preparación puede tardar varios minutos. Termina cuando los contenedores están activos, las cuentas fueron creadas y el snapshot quedó restaurado.

## Acceso

- Aplicación: <http://localhost:8083>
- Workspace directo: <http://localhost:8083/workbench/sanity-ws>
- Usuario principal: `user1`
- Usuario alternativo: `user2`
- Administrador: `admin`
- Contraseña de las tres cuentas: `1234`

Estas credenciales existen solo en la copia local de pruebas.

## Actualizar el frontend después de un cambio

Desde `tests`, reconstruir la imagen y reemplazar solo el contenedor necesario:

```bash
./build-reload.sh front
```

Los datos del workspace se conservan. Para volver al snapshot inicial:

```bash
./restore-workspace.sh
```

## Verificar el estado

```bash
docker compose -p sanity ps
docker compose -p sanity logs --tail=100 front account transactor
curl --fail http://localhost:8083
```

La copia está lista cuando `curl` responde correctamente y la pantalla de acceso permite entrar a `sanity-ws`.

## Ejecutar pruebas responsive

Desde `tests/sanity`:

```bash
PLATFORM_URI=http://localhost:8083 npx playwright test -c ./tests/playwright.config.ts ./tests/responsive.spec.ts
```

La suite cubre Android Chromium, iPhone WebKit e iPad WebKit. Los navegadores de Playwright deben estar instalados en la máquina que ejecuta las pruebas.

## Detener o eliminar la copia

Detener los contenedores y conservar los datos:

```bash
docker compose -p sanity stop
```

Eliminar contenedores, red y datos de la copia `sanity`:

```bash
docker compose -p sanity down --volumes
```

El segundo comando es destructivo para los datos locales de ese proyecto Compose. El siguiente `./prepare.sh` vuelve a crear todo desde el snapshot.

## Instancias aisladas

Docker Compose separa contenedores, red y volúmenes por nombre de proyecto. La revisión responsive actual usa `wiwo-responsive`, no `sanity`, para convivir con otros entornos locales. El backend pertenece a ese proyecto y el frontend `wiwo-responsive-front` es un contenedor independiente, conectado a `wiwo-responsive_default`, para no reemplazar otra imagen local `hardcoreeng/front`.

Diagnóstico:

```bash
docker compose -p wiwo-responsive -f tests/docker-compose.yaml ps
docker ps --filter name=wiwo-responsive-front
```

Apagado y eliminación de esa copia temporal:

```bash
docker rm -f wiwo-responsive-front
docker compose -p wiwo-responsive -f tests/docker-compose.yaml down --volumes
```

Ejecutar esos comandos desde la raíz del repositorio. El apagado elimina los datos de la copia `wiwo-responsive`; no afecta el proyecto Compose `sanity` ni otros stacks.
