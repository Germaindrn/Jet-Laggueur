# Jet Laggueur — Android App

Wrapper Android (WebView) du site Jet Laggueur. Les assets web sont embarqués dans `app/src/main/assets/www/`.

## Ouvrir dans Android Studio

1. **File → Open…** puis sélectionner le dossier `app android`.
2. Android Studio télécharge Gradle 8.7 et les dépendances (quelques minutes la première fois).
3. Attendre la fin du **Gradle sync**.
4. Brancher un téléphone (mode développeur activé) ou lancer un émulateur, puis cliquer **Run ▶**.

## Mettre à jour les assets web

Après modification du site (`index.html`, `css/`, `js/`), recopier les fichiers dans :

```
app android/app/src/main/assets/www/
```

Puis relancer le build.

## Notes techniques

- `minSdk` = 24 (Android 7.0+)
- `targetSdk` = 34
- Les assets sont servis via `WebViewAssetLoader` sur `https://appassets.androidplatform.net/assets/www/` pour que `localStorage` fonctionne correctement (origine HTTPS stable).
- Le bouton retour matériel navigue dans l'historique de la WebView.
