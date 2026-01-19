# Stellar Wallets Kit Workshop

Este repositorio contiene el código fuente desarrollado durante el workshop sobre integración de billeteras en el ecosistema Stellar.

## 🛠 Herramientas y Stack Tecnológico
Este proyecto ha sido construido utilizando las siguientes tecnologías:

* **Vite + React:** Para la estructura del frontend, optimizado para velocidad.
* **TypeScript:** Para garantizar el tipado seguro al interactuar con la blockchain.
* **Stellar Wallets Kit:** Librería principal que actúa como "puente" unificado para conectar múltiples billeteras con una sola implementación.
* **stellar-sdk:** SDK oficial para construir las transacciones (XDR) que luego serán firmadas por el kit.

## ¿Para qué sirve este código?
El objetivo de este proyecto es resolver la fragmentación de billeteras en dApps de Stellar. Específicamente, este código permite:

1.  **Abstracción de Conexión:** Invocar un modal estandarizado que permite al usuario elegir su wallet preferida (Freighter, xBull, Albedo, WalletConnect, etc.).
2.  **Gestión de Sesión:** Obtener y mostrar la clave pública (Public Key) del usuario y su balance en tiempo real.
3.  **Firma de Transacciones:** Construir una operación de pago en el código y solicitar la firma a la wallet conectada sin necesidad de gestionar la lógica privada de cada proveedor.
4.  **Interacción con Testnet:** Probar flujos reales de dinero utilizando la red de prueba de Stellar (sin costo real).
