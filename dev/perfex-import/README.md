# perfex-import

Migra clientes, proyectos y tareas de Perfex CRM a un workspace de Huly.

Los datos se reparten en cuatro ambientes, uno por workspace, según el **grupo de cliente** de
Perfex:

| Ambiente (`--env`) | Grupos de Perfex | Clientes | Proyectos | Tareas |
|---|---|---|---|---|
| `mgc` | MGC HQ, MGC Andina, MGC Caribe, MGC USA, Aima, Foundaxis, HL, iLuk | 67 | 188 | 1665 |
| `palta` | Palta | 10 | 5 | 1 |
| `wiwo` | WIWO | 11 | 14 | 59 |
| `sin-clasificar` | los que no tienen grupo, o un grupo que nadie reclama | 33 | 63 | 751 |

Cada cliente va a un solo ambiente. Hay clientes que están en dos grupos a la vez (MGC HQ y WIWO):
para esos gana el grupo más específico, según el orden de `ENVIRONMENTS` en `src/mapping.ts`. Si
mañana aparece un grupo nuevo en Perfex, sus clientes caen en `sin-clasificar` hasta que se lo
agregue a un ambiente.

## Qué migra

| Perfex | Huly |
|--------|------|
| `tblstaff` | Personas (contactos). Cuando esa persona se registre con el mismo email, su cuenta queda vinculada al contacto ya creado |
| `tblclients` | Organizaciones, con teléfono y sitio web como canales de contacto |
| `tblprojects` | Proyectos del Tracker. Los cerrados o cancelados quedan archivados |
| `tbltasks` | Tareas, con estado, prioridad, responsable, fechas de inicio y vencimiento |
| campo "Area de la compañía" | Atributo `companyArea` de la tarea (admite varias áreas) |
| campo "Link de Drive" | Atributo `driveLink` de la tarea |
| `tbltask_comments` | Comentarios de la tarea, con el nombre del autor de Perfex al inicio |
| tareas sin proyecto | Van al proyecto **Sin proyecto (Perfex)** |

Los estados de Perfex se crean tal cual en Huly: Sin empezar, En progreso, Testing, Esperando
feedback y Completada.

**Límites conocidos:**

- Una tarea de Perfex puede tener varios asignados; Huly admite un solo responsable. Queda el
  primero como responsable y los demás se listan al final de la descripción. No se pueden cargar
  como colaboradores porque en Huly eso requiere que cada uno tenga cuenta.
- Los archivos adjuntos no se migran: el dump de la base sólo tiene las rutas, no los archivos.
  Hay que copiarlos del servidor de Perfex si se los quiere.
- Los comentarios quedan a nombre del usuario que corre la migración, con el autor original
  indicado en el texto.

## Antes de correrlo

1. Desplegar en Huly los cambios del fork: la migración escribe `companyArea` y `driveLink`, que
   sólo existen a partir de esa versión.
2. Hacer backup del workspace (`backend/wiwo.ops/backup-create.sh`).
3. Tener acceso de lectura a la base de Perfex, o cargar un dump en un MySQL accesible.

## Cómo se corre

Las credenciales de Perfex van por variables de entorno; nunca por parámetro, para que no queden
en el historial de la terminal:

```bash
export PERFEX_DB_HOST=board.wiwo.me
export PERFEX_DB_PORT=3306
export PERFEX_DB_USER=usuario_solo_lectura
export PERFEX_DB_PASSWORD=...
export PERFEX_DB_NAME=wiwoadmin_wiwo_board_db
export FRONT_URL=https://ops.wiwo.me
```

Simulación, que no escribe nada en Huly y ni siquiera se conecta (sirve para ver qué encontraría):

```bash
cd frontend/dev/perfex-import
rushx run import --dry-run -e mgc -u admin@wiwo.me -p '...' -w mgc
```

Migración real, por etapas:

```bash
rushx run import -e mgc -u admin@wiwo.me -p '...' -w mgc --stages personas
rushx run import -e mgc -u admin@wiwo.me -p '...' -w mgc --stages clientes
rushx run import -e mgc -u admin@wiwo.me -p '...' -w mgc --stages proyectos
```

El orden importa: las tareas necesitan las personas ya creadas para poder asignarles responsable.

Después se repite lo mismo para cada ambiente, cambiando `--env` y `--workspace`:

```bash
rushx run import -e palta -u admin@wiwo.me -p '...' -w palta
rushx run import -e wiwo  -u admin@wiwo.me -p '...' -w wiwo
rushx run import -e sin-clasificar -u admin@wiwo.me -p '...' -w sin-clasificar
```

Los workspaces tienen que existir de antes y el usuario indicado tiene que ser miembro con permiso
para crear proyectos en cada uno. El staff se crea completo en todos los ambientes: la misma
persona trabaja en varios y hace falta poder asignarle tareas en cualquiera.

## Repetir la corrida

Cada documento creado se anota en `perfex-import-state-<ambiente>.json` (se puede cambiar con
`--state`). Cada ambiente lleva su propio archivo: no se deben mezclar.
Volver a correr el comando salta lo que ya está migrado, así que es seguro reintentar después de
un error. Si se borra ese archivo, la próxima corrida duplica todo.

## Opciones

| Opción | Para qué |
|--------|----------|
| `-u, --user` / `-p, --password` | Usuario de Huly con permiso para crear proyectos |
| `-w, --workspace` | Url del workspace destino |
| `-e, --env` | Ambiente a migrar: `mgc`, `palta`, `wiwo` o `sin-clasificar` |
| `-f, --front` | Url del front, si no se usa `FRONT_URL` |
| `-s, --stages` | `personas`, `clientes`, `proyectos`, separadas por coma |
| `--state` | Archivo de estado para poder repetir la corrida |
| `--dry-run` | Sólo informa qué haría |
