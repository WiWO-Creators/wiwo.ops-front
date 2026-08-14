# perfex-clients

Migra los clientes de Perfex CRM a Huly. Sólo clientes: no toca proyectos, tareas ni comentarios.

## Qué crea

| Perfex | Huly |
|--------|------|
| Staff (`tblstaff`) | Persona ligada a su correo. Cuando entre con ese correo, su cuenta queda vinculada |
| Cliente (`tblclients`) | Organización, con ciudad, teléfono y sitio web |
| Carpeta de Drive del cliente | Un enlace más en la organización |
| Contacto del cliente (`tblcontacts`) | Persona con su correo y teléfono, asociada a la organización como miembro |
| Proyecto (`tblprojects`) | Proyecto del Tracker; los cerrados quedan archivados |
| Tarea (`tbltasks`) | Tarea con estado, prioridad, responsable, fechas, área de la compañía y link de Drive |
| Comentario (`tbltask_comments`) | Comentario de la tarea, con el nombre del autor de Perfex al principio |
| Tarea sin proyecto | Va al proyecto **Sin proyecto (Perfex)** |

Los estados de Perfex se crean tal cual: Sin empezar, En progreso, Testing, Esperando feedback y
Completada.

**Los clientes dados de baja se omiten** salvo que se pase `--incluir-inactivos`, y con ellos
quedan afuera sus proyectos y tareas: 25 proyectos y 88 tareas. Para una migración completa hay
que pasar ese flag.

### Límites conocidos

- Una tarea de Perfex puede tener varios asignados; Huly admite un solo responsable. Queda el
  primero y los demás se listan al final de la descripción, porque los colaboradores de Huly son
  cuentas de usuario y el staff migrado todavía no las tiene.
- Los archivos adjuntos no se migran: la base sólo guarda las rutas, los archivos están en el
  disco del servidor de Perfex.
- Los comentarios quedan a nombre de quien corre la migración, con el autor original en el texto.
- Las tareas escriben `companyArea` y `driveLink`, que existen a partir de los cambios de este
  fork: **hay que desplegarlo antes de migrar**.

## Ambientes

Cada ambiente es un workspace distinto y se decide por el **grupo de cliente** de Perfex:

Con `--incluir-inactivos`, que es lo que corresponde a una migración completa:

| Ambiente (`--env`) | Grupos de Perfex | Clientes | Proyectos | Tareas |
|---|---|---|---|---|
| `mgc` | MGC HQ, MGC Andina, MGC Caribe, MGC USA, Aima, Foundaxis, HL, iLuk | 67 | 188 | 1665 |
| `palta` | Palta | 10 | 5 | 1 |
| `wiwo` | WIWO | 11 | 14 | 59 |
| `sin-clasificar` | los que no tienen grupo, o un grupo que nadie reclama | 33 | 63 | 751 |

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

Migración real. Un solo comando por ambiente: hace staff, clientes, proyectos, tareas y
comentarios de corrido.

```bash
export HULY_TOKEN=$(cd ../../../backend/wiwo.ops && ./run-tool.sh generate-token tu-correo@wiwo.me wiwo)
rushx run import -e wiwo -w wiwo --incluir-inactivos
```

Y lo mismo para cada ambiente, regenerando el token con el workspace que corresponda:

```bash
rushx run import -e mgc            -w mgc            --incluir-inactivos
rushx run import -e palta          -w palta          --incluir-inactivos
rushx run import -e sin-clasificar -w sin-clasificar --incluir-inactivos
```

Si preferís ir por partes, `--stages personas`, `--stages clientes` o `--stages proyectos` corren
sólo esa parte. El orden importa: las tareas necesitan el staff ya creado para poder asignar
responsables.

Los workspaces tienen que existir de antes, y el usuario indicado tiene que ser miembro de cada
uno.

## Que el equipo vea y trabaje las tareas

En Huly, un proyecto público aparece en el menú pero **sus tareas sólo las ve quien es miembro**.
La migración ya suma a todo el equipo como miembro de cada proyecto y los deja en modo "se suman
solos", así que quien entre después también los ve.

Para los proyectos migrados antes de esta corrección, o cuando entra gente nueva:

```bash
export HULY_TOKEN='<token del workspace>'
node bundle.js abrir -w mgc -t "$HULY_TOKEN" --dry-run
node bundle.js abrir -w mgc -t "$HULY_TOKEN"
```

Suma a todas las personas con cuenta como miembros de todos los proyectos. Correrlo dos veces no
hace nada la segunda: sólo toca lo que falta.

Los permisos de trabajo no hay que darlos: en Huly, cualquiera que vea un proyecto puede crear
tareas, asignarlas y cambiarles el estado. Lo único reservado es administrar el espacio.

### Quién figura como autor

Los documentos quedan a nombre de la cuenta cuyo token se usó. Para que no aparezca todo a nombre
de una persona, generá el token con la cuenta de sistema:

```bash
./run-tool.sh generate-token huly.system@hc.engineering mgc
```

Los ya migrados conservan el autor con el que se crearon; no afecta a quién puede trabajar sobre
ellos.

## Invitación permanente para la pantalla de ingreso

La pantalla de ingreso ofrece los workspaces configurados en `dev/prod/public/branding.json`, y de
cada uno necesita el identificador de una invitación sin vencimiento ni límite de usos. La interfaz
de Huly no deja crearlas así, pero el servicio de cuentas sí las acepta:

```bash
export FRONT_URL=https://ops.wiwo.me
export HULY_TOKEN='<token del workspace>'
node bundle.js invitacion -t "$HULY_TOKEN"
```

Devuelve el `inviteId`, que se copia a `joinableWorkspaces` en `branding.json`. Hay que repetirlo
por cada workspace, con su token.

Para revocar una invitación basta con generar otra y reemplazar el identificador en la
configuración: la anterior deja de estar publicada.

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

## Migrar sólo una parte de las tareas

Con miles de tareas la corrida se hace larga. Hay dos recortes, combinables:

```bash
# sólo lo del último mes
node bundle.js import -e mgc -w mgc --incluir-inactivos --ultimos-meses 1

# desde una fecha exacta
node bundle.js import -e mgc -w mgc --incluir-inactivos --desde 2026-08-01

# sólo lo que sigue abierto, sin importar cuándo se creó
node bundle.js import -e mgc -w mgc --incluir-inactivos --solo-abiertas
```

Los clientes y sus proyectos se crean igual; lo que se recorta son las tareas, y los componentes
se crean sólo para las campañas que quedaron con alguna tarea. Después se puede ampliar: correr de
nuevo con un rango mayor agrega lo que falta sin duplicar lo ya migrado.

## Migrar por tandas, de lo nuevo a lo viejo

Con miles de tareas conviene no hacerlo todo de una. La receta:

```bash
# 1. La estructura primero: personas, clientes y contactos. Es rápido.
node bundle.js import -e mgc -w mgc --incluir-inactivos --stages personas,clientes

# 2. Las tareas del mes en curso: el sistema ya queda usable.
node bundle.js import -e mgc -w mgc --incluir-inactivos --stages proyectos --desde 2026-08-01

# 3. El resto, en ventanas hacia atrás, cuando haya tiempo.
node bundle.js import -e mgc -w mgc --incluir-inactivos --stages proyectos --desde 2026-05-01 --hasta 2026-08-01
node bundle.js import -e mgc -w mgc --incluir-inactivos --stages proyectos --desde 2026-02-01 --hasta 2026-05-01
node bundle.js import -e mgc -w mgc --incluir-inactivos --stages proyectos --hasta 2026-02-01
```

Las ventanas no se pisan: `--desde` incluye la fecha y `--hasta` la excluye, así que las tandas
cubren todo sin repetir nada. Cada una se puede correr por separado, incluso en días distintos: el
archivo de estado recuerda lo hecho y los proyectos ya creados se reutilizan.

Entre tanda y tanda el sistema queda usable: lo que ya se migró se ve y se trabaja normal.

## Dejarlo corriendo sin esperar

La corrida no necesita supervisión: basta con lanzarla en segundo plano y revisar el log al final.

```bash
nohup node bundle.js import -e mgc -w mgc --incluir-inactivos > migracion-mgc.log 2>&1 &
echo $!            # número de proceso, por si hay que cortarlo

tail -f migracion-mgc.log     # seguirla en vivo
grep -E "Staff|Organizaciones|Proyectos|Tareas completadas" migracion-mgc.log   # revisar al final
```

El log deja una marca cada 200 tareas, así se ve el avance sin adivinar. Si el proceso muere, el
archivo de estado permite retomar donde quedó.

La corrida termina siempre con una línea que dice cómo le fue, y sale con código distinto de cero
si falló, así que se puede encadenar:

```
RESULTADO: ok — ambiente WiWO
RESULTADO: error — ambiente WiWO: Access denied for user ...
```

### Avisar cuando termina

Con `--avisar-a` (o la variable `AVISAR_URL`) manda el resultado por POST a la url indicada, tanto
si terminó bien como si falló:

```bash
nohup node bundle.js import -e mgc -w mgc --incluir-inactivos \
  --avisar-a 'https://hooks.slack.com/services/...' > migracion-mgc.log 2>&1 &
```

El cuerpo trae un campo `text` con el resumen ya armado —que es lo que muestran Slack y Discord— y
además `ok`, `environment`, `summary` y `error`, para un webhook propio o un flujo de n8n. Si el
aviso no se puede entregar, queda anotado en el log y la migración se da por terminada igual.

## Empezar de cero

Si el workspace quedó con datos repetidos —por ejemplo por haber corrido la migración sin el
archivo de estado— conviene vaciarlo y volver a importar, en vez de andar cazando duplicados:

```bash
export HULY_TOKEN='<token del workspace>'

# 1. Ver qué se borraría. Sin --si-borrar-todo no toca nada.
node bundle.js limpiar -w mgc -t "$HULY_TOKEN"

# 2. Borrar de verdad
node bundle.js limpiar -w mgc -t "$HULY_TOKEN" --si-borrar-todo

# 3. Borrar el archivo de estado de ese ambiente
rm -f perfex-clients-state-mgc.json

# 4. Importar de nuevo
node bundle.js import -e mgc -w mgc --incluir-inactivos
```

Borra los proyectos con todas sus tareas, componentes e hitos, las empresas y las personas sin
cuenta. **Las personas con cuenta se conservan**: son el equipo, no vinieron de Perfex.

Es un borrado sin vuelta atrás: si en esos proyectos ya hay trabajo cargado a mano, se pierde.

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
| `--incluir-inactivos` | Migra también los clientes dados de baja, con sus proyectos y tareas |
| `--desde <AAAA-MM-DD>` | Sólo tareas creadas desde esa fecha |
| `--ultimos-meses <n>` | Sólo tareas de los últimos n meses |
| `--solo-abiertas` | Deja fuera las tareas ya completadas |
| `-s, --stages` | `personas`, `clientes`, `proyectos`, separadas por coma |
| `--state` | Archivo de estado propio |
| `--dry-run` | Sólo informa qué haría |

Del comando `invitacion`:

| Opción | Para qué |
|--------|----------|
| `-t, --token` | Token del workspace para el que se crea la invitación |

Del comando `limpiar`:

| Opción | Para qué |
|--------|----------|
| `-w, --workspace` / `-t, --token` | Workspace y token |
| `--si-borrar-todo` | Confirma el borrado; sin esto sólo informa |

Del comando `abrir`:

| Opción | Para qué |
|--------|----------|
| `-w, --workspace` / `-t, --token` | Workspace y token |
| `--dry-run` | Sólo informa qué cambiaría |

Del comando `mover`:

| Opción | Para qué |
|--------|----------|
| `-c, --cliente` | Nombre del cliente en el workspace de origen |
| `--desde-token` / `--hacia-token` | Tokens de origen y destino (el token ya identifica el workspace) |
| `--solo-copiar` | Copia al destino sin borrar del origen |
