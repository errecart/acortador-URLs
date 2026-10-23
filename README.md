# Acortador de URLs

## Ejecución con permisos restringidos

`npm run start:secure` inicia el servidor con el modelo de permisos de Node.js. Permite leer el código de `src/`, los recursos de `public/`, `.env` y los datos de `data/`; las escrituras quedan limitadas a `data/`. El script crea `data/` antes de iniciar Node porque el directorio debe existir al conceder permisos a `data/*`.

Si cambiás `DATA_DIR` para usar otra ubicación, actualizá también las rutas `--allow-fs-read` y `--allow-fs-write` del script. El permiso de escritura es intencionalmente limitado: si el access log u otro código intenta escribir fuera de `data/`, Node lo rechaza con `ERR_ACCESS_DENIED`.

## Idioma

Los mensajes visibles para las personas se escriben en español, tanto en el servidor/API como en el CLI y la interfaz web. Se mantienen sin traducir los identificadores técnicos, los nombres de propiedades JSON y los valores de protocolo.
