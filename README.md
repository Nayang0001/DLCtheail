# Evrima Pack Companion

Aplicación de escritorio independiente para compartir con amigos una ficha limitada a:

- Dinosaurio, estado Prime y mutaciones.
- Salud, estamina, hambre, agua y crecimiento.

Cada jugador ejecuta su companion. El companion intenta leer la ventana seleccionada mediante OCR local y envía solo esos campos al relay de la sala. El relay no consulta ni modifica el juego o Arkadia Overlay.

## Requisitos

- Windows 10/11.
- Node.js 20 o posterior.
- Una ventana visible de Arkadia Overlay con el panel del dinosaurio.

## Ejecutar en desarrollo

```powershell
npm install
npm start
```

En otra terminal puedes ejecutar el relay de prueba:

```powershell
npm run relay
```

En la aplicación usa `ws://localhost:8787/ws`, crea una sala y comparte el código con tus amigos. Para probar desde otros equipos por Internet, despliega el relay usando los pasos de Railway y configura su URL `wss://.../ws`.

## Desplegar el relay en Railway

1. Crea un proyecto Railway desde este repositorio.
2. En Settings, configura **Root Directory** como `/relay`; así Railway instala únicamente las dependencias del relay y no Electron/OCR.
3. El comando de inicio es `npm start` (también está definido en `relay/railway.json`).
4. Railway asigna la variable `PORT`; el relay la utiliza automáticamente.
5. Añade un dominio público al servicio.
6. En la app, introduce `wss://TU-DOMINIO/ws`.
7. Comprueba `https://TU-DOMINIO/health`; debe responder JSON con `"ok":true`.

El relay mantiene los estados en memoria: no guarda historial y las salas se borran al quedar vacías. Las salas tienen códigos aleatorios de seis caracteres y un máximo de doce jugadores.

## Notas de beta y privacidad

- El SteamID64 escrito se usa como identificador de tarjeta, pero **no verifica la propiedad de la cuenta**. No escribas tu contraseña de Steam.
- El OCR procesa capturas localmente. La captura puede incluir otros elementos visibles de la ventana seleccionada; no se envía la imagen al relay.
- Solo se transmite dinosaurio, Prime, mutaciones, los cinco porcentajes, nombre e identificador Steam.
- La app no accede a memoria del juego, no inyecta código y no automatiza acciones de juego.
- El OCR y los nombres de mutaciones todavía necesitan validación con capturas reales de cada jugador; comprueba la ficha antes de confiar en ella.
- No alojes el relay en una URL pública `ws://`; utiliza TLS (`wss://`) fuera de pruebas locales.

## Pruebas

```powershell
npm test
```
