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

Simulación, que no escribe nada y ni siquiera se conecta a Huly:

```bash
cd frontend/dev/perfex-clients
rushx run import --dry-run -e mgc -u admin@wiwo.me -p '...' -w mgc
```

Migración real, una corrida por ambiente:

```bash
rushx run import -e mgc            -u admin@wiwo.me -p '...' -w mgc
rushx run import -e palta          -u admin@wiwo.me -p '...' -w palta
rushx run import -e wiwo           -u admin@wiwo.me -p '...' -w wiwo
rushx run import -e sin-clasificar -u admin@wiwo.me -p '...' -w sin-clasificar
```

Los workspaces tienen que existir de antes, y el usuario indicado tiene que ser miembro de cada
uno.

## Repetir la corrida

Lo migrado se anota en `perfex-clients-state-<ambiente>.json` (se cambia con `--state`), después de
cada cliente. Volver a correr el comando salta lo que ya está hecho, así que es seguro reintentar
tras un error o un corte. Si se borra ese archivo, la próxima corrida duplica todo.

## Opciones

| Opción | Para qué |
|--------|----------|
| `-u, --user` / `-p, --password` | Usuario de Huly con acceso al workspace |
| `-w, --workspace` | Url del workspace destino |
| `-e, --env` | Ambiente: `mgc`, `palta`, `wiwo` o `sin-clasificar` |
| `-f, --front` | Url del front, si no se usa `FRONT_URL` |
| `--incluir-inactivos` | Migra también los clientes dados de baja |
| `--state` | Archivo de estado propio |
| `--dry-run` | Sólo informa qué haría |
