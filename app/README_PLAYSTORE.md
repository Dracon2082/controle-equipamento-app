# Publicacao na Play Store (Android)

Este projeto ja esta preparado com Capacitor e pasta Android nativa em:

- `C:/Users/amare/controle-equipamento/app/android`

## 1) Atualizar app web dentro do Android

Sempre que houver mudanca no sistema, rode:

```bash
cd C:/Users/amare/controle-equipamento/app
npm run android:build
```

Isso:
- gera o build React (`build/`)
- sincroniza no projeto Android (`android/`)

## 2) Abrir no Android Studio

```bash
cd C:/Users/amare/controle-equipamento/app
npm run android:open
```

## 3) Gerar pacote para Play Store (AAB)

No Android Studio:

1. `Build` -> `Generate Signed Bundle / APK`
2. Escolha `Android App Bundle`
3. Crie (ou selecione) o `keystore`
4. Build Variant: `release`
5. Finalize e gere o arquivo `.aab`

O arquivo final normalmente fica em:

- `C:/Users/amare/controle-equipamento/app/android/app/release/app-release.aab`

## 4) Subir na Play Console

1. Acesse Google Play Console
2. Crie o app (ou abra o app existente)
3. Em `Producao` (ou `Teste interno`), envie o `.aab`
4. Preencha ficha da loja, politica de privacidade e classificacoes
5. Envie para revisao

## 5) Checklist rapido antes de publicar

- Nome do app correto
- Icone e splash corretos
- Politica de privacidade publicada
- Login funcionando online e offline (usuario ja logado antes)
- Fluxos principais testados em celular real

## Observacao importante

Hoje o app funciona offline para operacao quando o usuario ja entrou antes no aparelho.
Primeiro login ainda exige internet (comportamento padrao do Firebase Auth).
