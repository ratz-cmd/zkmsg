# Architecture Cryptographique : ZKMsg Device Pairing (Phase 6)

L'appairage multi-appareils (Device Provisioning) est le processus par lequel un nouvel appareil (Esclave/Desktop) rejoint un compte ZKMsg existant géré par un appareil maître (Mobile), de manière 100% Zero-Knowledge et sans transmettre de clés privées asymétriques.

## Modèle de Menace & Contraintes
1. Le serveur de relais Go ne doit STRICTEMENT RIEN pouvoir déchiffrer.
2. Les clés privées d'Identité (Ed25519) sont propres au matériel (Hardware-bound) et ne doivent **jamais** quitter l'appareil. Seule la "Seed Phrase" (Mnémonique BIP39 originel) et la clé SQLCipher naviguent dans le tunnel pour restaurer l'accès au graphe de contacts.
3. Risque MITM (Man-in-the-Middle) évité : La clé éphémère du Desktop transite optiquement (QR Code) et non par le réseau.

---

## Séquence Cryptographique (Le Tunnel Éphémère)

### Étape 1 : Initialisation (Desktop / Appareil Esclave)
1. Le Desktop génère un ID de session aléatoire (`SessionID`, 32 octets).
2. Le Desktop génère une paire de clés éphémères X25519 : `E_desk_priv` et `E_desk_pub`.
3. Le Desktop génère et affiche un **QR Code** contenant : `[ SessionID, E_desk_pub ]`.
4. Le Desktop se connecte au serveur Go (WebSocket) en s'abonnant au canal `SessionID` et attend.

### Étape 2 : Scan et Échange de Clés (Mobile / Appareil Maître)
1. Le Mobile (déjà authentifié) scanne le QR Code.
2. Le Mobile génère à son tour une paire de clés éphémères X25519 : `E_mob_priv` et `E_mob_pub`.
3. Le Mobile calcule le secret partagé DH : `Secret = X25519(E_mob_priv, E_desk_pub)`.
4. Le Mobile dérive une clé de session symétrique via HKDF : `SessionKey = HKDF_SHA256(Secret, salt="zkmsg-pairing")`.

### Étape 3 : Chiffrement du Payload (Mobile)
1. Le Mobile prépare le `SyncPayload` (JSON) contenant :
   - La `Seed Phrase` maître.
   - La `Root DB Key` (pour déverrouiller l'historique exporté).
   - Sa propre clé publique d'Identité pour authentification de la flotte.
2. Le Mobile chiffre ce payload avec `XChaCha20-Poly1305` en utilisant la `SessionKey` et un nonce généré aléatoirement.
3. Le Mobile envoie le paquet suivant au serveur Go sur le canal `SessionID` : 
   `[ E_mob_pub, Nonce, Ciphertext ]`.

### Étape 4 : Déchiffrement et Clôture (Desktop)
1. Le serveur Go relaie (en aveugle) le paquet au Desktop qui écoute sur `SessionID`.
2. Le Desktop calcule le même secret partagé DH : `Secret = X25519(E_desk_priv, E_mob_pub)`.
3. Le Desktop dérive la `SessionKey = HKDF_SHA256(Secret, salt="zkmsg-pairing")`.
4. Le Desktop déchiffre le ciphertext avec `XChaCha20-Poly1305` via la `SessionKey`.
5. Le Desktop écrase instantanément en mémoire vive `E_desk_priv`, `SessionKey`, et le `Secret`. Le tunnel est détruit.

---

## Conclusion OpSec
- **Perfect Forward Secrecy (PFS)** : Immédiat. Dès le déchiffrement, toutes les clés éphémères sont détruites. Un attaquant qui saisirait l'appareil plus tard ne pourrait pas déchiffrer cette transaction réseau.
- **Résistance MITM** : Le serveur Go n'a jamais vu la clé publique du Desktop (`E_desk_pub` a voyagé par voie optique). Il ne peut donc pas injecter sa propre clé publique au Mobile (MITM).
