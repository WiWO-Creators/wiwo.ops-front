# perfex-clients

Migra los clientes de Perfex CRM a Huly. Sólo clientes: no toca proyectos, tareas ni comentarios.

## Qué crea

| Perfex | Huly |
|--------|------|
| Cliente (`tblclients`) | Organización, con ciudad, teléfono y sitio web |
| Carpeta de Drive del cliente | Un enlace más en la organización |
| Contacto del cliente (`tblcontacts`) | Persona con su email y teléfono, asociada a la organización como miembro |

Los clientes dados de baja en Perfex se omiten salvo que se pase `--incluir-inactivos`.

## Ambientes

Cada ambiente es un workspace distinto y se decide por el **grupo de cliente** de Perfex:

| Ambiente (`--env`) | Grupos de Perfex | Clientes activos | Contactos |
|---|---|---|---|
| `mgc` | MGC HQ, MGC Andina, MGC Caribe, MGC USA, Aima, Foundaxis, HL, iLuk | 58 | 3 |
| `palta` | Palta | 10 | 6 |
| `wiwo` | WIWO | 9 | 1 |
| `sin-clasificar` | los que no tienen grupo, o un grupo que nadie reclama | 29 | 3 |

Cada cliente va a un solo ambiente. Hay clientes que están en dos grupos a la vez (MGC HQ y WIWO):
para esos gana el grupo más específico, según el orden de `ENVIRONMENTS` en `src/environments.ts`.
Si aparece un grupo nuevo en Perfex, sus clientes caen en `sin-clasificar` hasta que se lo agregue
a un ambiente.

## Cómo se corre

Las credenciales de Perfex van por variables de entorno, nunca por parámetro, para que no queden en
el historial de la terminal:

```bash
export PERFEX_DB_HOST=board.wiwo.me
export PERFEX_DB_PORT=3306
export PERFEX_DB_USER=usuario_solo_lectura
export PERFEX_DB_PASSWORD=...
export PERFEX_DB_NAME=wiwoadmin_wiwo_board_db
export FRONT_URL=https://ops.wiwo.me
```

### Como identificarse en Huly

Si la instancia entra con Google, **no hay contraseña propia** y hay que usar un token del
workspace. Se genera en el servidor, uno por workspace:

```bash
cd backend/wiwo.ops
./run-tool.sh generate-token tu-correo@wiwo.me mgc
```

Ese token se pasa con `--token` o por la variable `HULY_TOKEN`. Los documentos quedan creados a
nombre del sistema, que es lo esperable para una carga masiva.

Si en cambio la instancia usa correo y contraseña, sirve `--user` y `--password`.

Simulación, que no escribe nada y ni siquiera se conecta a Huly:

```bash
cd frontend/dev/perfex-clients
rushx run import --dry-run -e mgc -w mgc
```

Migración real, una corrida por ambiente:

```bash
export HULY_TOKEN=$(cd ../../../backend/wiwo.ops && ./run-tool.sh generate-token tu-correo@wiwo.me wiwo)
rushx run import -e wiwo -w wiwo
```

Y lo mismo para cada ambiente, regenerando el token con el workspace que corresponda:

```bash
rushx run import -e mgc            -w mgc
rushx run import -e palta          -w palta
rushx run import -e sin-clasificar -w sin-clasificar
```

Los workspaces tienen que existir de antes, y el usuario indicado tiene que ser miembro de cada
uno.

## Mover un cliente de un workspace a otro

Huly no mueve documentos entre workspaces: cada uno es una base separada. El comando `mover` copia
el cliente al destino —con sus canales, sus contactos y los canales de esos contactos— y recién
después lo borra del origen.

```bash
export DESDE=$(cd ../../../backend/wiwo.ops && ./run-tool.sh generate-token tu-correo@wiwo.me mgc)
export HACIA=$(cd ../../../backend/wiwo.ops && ./run-tool.sh generate-token tu-correo@wiwo.me wiwo)

rushx run mover -c "Bodenor" --desde-token "$DESDE" --hacia-token "$HACIA" --dry-run
rushx run mover -c "Bodenor" --desde-token "$DESDE" --hacia-token "$HACIA"
```

Protecciones: si el cliente no está en el origen, o si ya existe uno con el mismo nombre en el
destino, no se mueve nada. Con `--solo-copiar` el original queda en su lugar, para revisar el
destino antes de borrar nada. Los contactos que además pertenezcan a otra empresa no se borran.

El cliente movido **no** vuelve a aparecer en el ambiente viejo si se repite la migración: el
archivo de estado recuerda que ya se había creado. Si querés que la próxima corrida lo mande solo
al ambiente nuevo, corregí su grupo en Perfex.

## Repetir la corrida

Lo migrado se anota en `perfex-clients-state-<ambiente>.json` (se cambia con `--state`), después de
cada cliente. Volver a correr el comando salta lo que ya está hecho, así que es seguro reintentar
tras un error o un corte. Si se borra ese archivo, la próxima corrida duplica todo.

## Opciones

| Opción | Para qué |
|--------|----------|
| `-t, --token` | Token del workspace (o variable `HULY_TOKEN`). Obligatorio si se entra con Google |
| `-u, --user` / `-p, --password` | Alternativa al token, sólo si la instancia usa contraseña propia |
| `-w, --workspace` | Url del workspace destino |
| `-e, --env` | Ambiente: `mgc`, `palta`, `wiwo` o `sin-clasificar` |
| `-f, --front` | Url del front, si no se usa `FRONT_URL` |
| `--incluir-inactivos` | Migra también los clientes dados de baja |
| `--state` | Archivo de estado propio |
| `--dry-run` | Sólo informa qué haría |

Del comando `mover`:

| Opción | Para qué |
|--------|----------|
| `-c, --cliente` | Nombre del cliente en el workspace de origen |
| `--desde-token` / `--hacia-token` | Tokens de origen y destino (el token ya identifica el workspace) |
| `--solo-copiar` | Copia al destino sin borrar del origen |
