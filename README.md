# Evrima Pack Companion

Aplicación de escritorio independiente para compartir con amigos una ficha limitada a:

- Dinosaurio, salud, hambre, agua y crecimiento, leídos desde el archivo local TempData de Evrima.
- Estamina, Prime y mutaciones no se leen de TempData observado y se muestran como no disponibles.

Cada jugador ejecuta su companion. La app sondea los archivos TempData recientes en `%LOCALAPPDATA%\TheIsle\Saved\Prelobby` y envía solo los campos leídos al relay de la sala. No toma capturas, usa OCR ni consulta o modifica el juego o Arkadia Overlay. La frecuencia efectiva depende de cuándo Evrima escriba el archivo; en esta instalación se observó una cadencia cercana a 72 segundos, no una actualización garantizada instantánea.

## Requisitos

- Windows 10/11.
- Node.js 20 o posterior.
- The Isle: Evrima instalado para el usuario actual y un personaje cargado para que exista TempData reciente.

## Ejecutar en desarrollo

```powershell
npm install
npm install --prefix relay
npm start
```

En otra terminal puedes ejecutar el relay de prueba:

```powershell
npm run relay
```

En la aplicación, el relay desplegado en Railway viene configurado por defecto: introduce tu nombre y SteamID64, crea una sala y comparte el código con tus amigos. Después inicia el seguimiento local. Cada amigo debe unirse con el código, introducir su perfil e iniciar también su seguimiento. Para probar el relay local, sustituye la URL por `ws://localhost:8787/ws`; al reiniciar, la URL local guardada vuelve automáticamente al relay de Railway.

## Desplegar el relay en Railway

1. Crea un proyecto Railway desde este repositorio.
2. En Settings, configura **Root Directory** como `/relay`; el paquete del relay tiene su propio `package.json` y lockfile, así que Railway instala solo sus dependencias, no Electron/OCR.
3. El comando de inicio es `npm start` (también está definido en `relay/railway.json`).
4. Railway asigna la variable `PORT`; el relay la utiliza automáticamente.
5. Añade un dominio público al servicio.
6. En la app, introduce `wss://TU-DOMINIO/ws`.
7. Comprueba `https://TU-DOMINIO/health`; debe responder JSON con `"ok":true`.

El relay mantiene los estados en memoria: no guarda historial y las salas se borran al quedar vacías. Las salas tienen códigos aleatorios de seis caracteres y un máximo de doce jugadores.

## Notas de beta y privacidad

- El SteamID64 escrito se usa como identificador de tarjeta, pero **no verifica la propiedad de la cuenta**. No escribas tu contraseña de Steam.
- Solo se transmite dinosaurio, los campos presentes en TempData, nombre e identificador Steam. El relay no recibe el archivo.
- La app no accede a memoria del juego, no inyecta código y no automatiza acciones de juego.
- El formato y la interpretación de TempData se basan en muestras observadas y aún necesitan validación con distintas versiones y especies. Comprueba las lecturas en juego antes de confiar en ellas.
- La actualización visible no puede ser más frecuente que las escrituras de TempData del juego; puede haber retraso entre cambios en el dinosaurio y la actualización para los amigos.
- No alojes el relay en una URL pública `ws://`; utiliza TLS (`wss://`) fuera de pruebas locales.

## Pruebas

```powershell
npm test
```
