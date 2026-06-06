# Guide de test fonctionnel — MCP Custom Standard

## Ce que fait ce logiciel

Ce serveur orchestre le workflow de création d'une **fiche de poste** en entreprise.
Un agent IA (Claude, etc.) l'utilise comme moteur sécurisé : identité, droits, ordre des
étapes, traçabilité. Trois étapes dans la V1 :

1. **Soumettre une demande** — un manager ouvre un dossier de recrutement
2. **Générer la fiche de poste** — l'IA rédige un brouillon (un vrai Google Doc en mode live)
3. **Approuver la fiche** — le manager valide, enregistre la ligne Google Sheets et **notifie les RH par email** (D1)

Le serveur protège chaque étape : bon rôle, bon ordre, zéro doublon, tout tracé.

---

## Prérequis

- Node.js ≥ 20 installé (`node -v` dans un terminal pour vérifier)
- Projet téléchargé, dépendances installées (`npm install`)
- Un terminal PowerShell

---

## Test 1 — Vérification automatique (5 minutes, à faire en premier)

Couvre l'intégralité des règles du standard sans aucune configuration.

```powershell
npm test
```

**Résultat attendu : 45 tests verts, 0 erreur.**

Ce que les tests vérifient en termes métier :

| Groupe de tests | Ce qui est vérifié |
|---|---|
| Contrats (`standard`, `storageAdapter`) | Tous les outils et la persistance respectent le standard |
| Workflow complet (submit → generate → approve) | Le parcours normal fonctionne de bout en bout |
| Mauvaise saisie | Un formulaire incomplet est rejeté |
| Contrôle de rôle | Un employé ne peut pas approuver — seul le manager peut |
| Ordre des étapes | On ne peut pas rejouer une étape dans le mauvais ordre |
| Anti-doublon | Relancer la même étape deux fois ne crée pas de doublon |
| Email RH à l'approbation (D1) | `approve` notifie les RH ; un échec d'email ne fait pas échouer l'approbation |
| Identité depuis la feuille (D2) | Le rôle est résolu depuis l'onglet `Users` ; repli sur l'en-tête si absent |
| Connecteur Gmail live | Construction RFC822/base64url + mapping d'erreur `CONNECTOR_ERROR` |

Si les tests sont verts : **le cœur du système est conforme à la spec.**

---

## Test 2 — Serveur en direct (20 minutes)

Ce test démarre le vrai serveur HTTP et envoie de vraies requêtes, comme le ferait un agent IA.

### Étape A — Configurer l'environnement

Copier `.env.example` → `.env` (dans le même dossier). Vérifier que le fichier `.env` contient :

```
API_KEY=dev-local-key
COMPANY_CONFIG_PATH=config/company.example.yaml
```

### Étape B — Démarrer le serveur

Ouvrir un **premier terminal** et laisser tourner :

```powershell
npm run build
npm start
```

Attendez la ligne : `"msg":"mcp-custom-standard listening"` (ou similaire).

### Étape C — Vérifier que le serveur répond

Dans un **deuxième terminal**, ouvrir un navigateur à l'adresse :

```
http://localhost:3000/healthz
```

Ou depuis PowerShell :

```powershell
Invoke-RestMethod http://localhost:3000/healthz
```

**Résultat attendu :** `ok : True`

### Étape D — Jouer le scénario métier

**Scénario :** Marie (manager chez Acme Corp) crée une fiche de poste pour un ingénieur backend.

Copier-coller les blocs dans l'ordre dans le **deuxième terminal**.

---

#### Initialisation (une seule fois — définit les en-têtes)

```powershell
$h = @{
    "Content-Type" = "application/json"
    "Accept"       = "application/json"
    "x-api-key"    = "dev-local-key"
    "x-company-id" = "acme"
    "x-actor-id"   = "marie"
    "x-actor-role" = "manager"
}
```

---

#### Commande 1 — Soumettre la demande de recrutement

```powershell
$r1 = Invoke-RestMethod http://localhost:3000/mcp -Method POST -Headers $h -Body (
    ConvertTo-Json -Depth 5 @{
        jsonrpc = "2.0"; id = 1; method = "tools/call"
        params  = @{
            name      = "submit_job_request"
            arguments = @{ title = "Ingénieur Backend"; justification = "Croissance de l'équipe"; plannedHire = $true }
        }
    }
)
$data1     = $r1.result.content[0].text | ConvertFrom-Json
$instanceId = $data1.data.processInstanceId
Write-Host "==> Statut  : $($data1.data.status)"
Write-Host "==> ID dossier : $instanceId"
```

**Résultat attendu :**
```
==> Statut     : pending_manager_validation
==> ID dossier : 3f2a8c10-... (un UUID — noter cette valeur, elle est réutilisée)
```

---

#### Commande 2 — Générer la fiche de poste

> `$instanceId` doit être défini par la commande précédente. Si vous avez redémarré le terminal, copiez-collez la valeur manuellement : `$instanceId = "3f2a8c10-..."`

```powershell
$r2    = Invoke-RestMethod http://localhost:3000/mcp -Method POST -Headers $h -Body (
    ConvertTo-Json -Depth 5 @{
        jsonrpc = "2.0"; id = 2; method = "tools/call"
        params  = @{
            name      = "generate_job_description"
            arguments = @{ processInstanceId = $instanceId; idempotencyKey = "gen-1"; targetSummary = "Responsable de la couche API" }
        }
    }
)
$data2 = $r2.result.content[0].text | ConvertFrom-Json
Write-Host "==> Statut     : $($data2.data.status)"
Write-Host "==> ID document : $($data2.data.docId)"
```

**Résultat attendu :**
```
==> Statut      : pending_manager_validation  (inchangé — c'est une recommandation, pas une validation)
==> ID document : doc_xxxxxxxxxxxxxxxx
```

---

#### Commande 3 — Approuver la fiche de poste

```powershell
$r3    = Invoke-RestMethod http://localhost:3000/mcp -Method POST -Headers $h -Body (
    ConvertTo-Json -Depth 5 @{
        jsonrpc = "2.0"; id = 3; method = "tools/call"
        params  = @{
            name      = "approve_job_description"
            arguments = @{ processInstanceId = $instanceId; idempotencyKey = "appr-1"; jobTitle = "Ingénieur Backend" }
        }
    }
)
$data3 = $r3.result.content[0].text | ConvertFrom-Json
Write-Host "==> Statut : $($data3.data.status)"
Write-Host "==> Ligne sheet : $($data3.data.rowId)"
Write-Host "==> Email RH : $($data3.data.messageId)"
```

> Pas de `docUrl` ici : le serveur réutilise l'URL de confiance produite à l'étape *generate*
> (persistée dans l'état du process). Le `messageId` n'apparaît que si un destinataire RH est
> résolu (onglet `Users` rôle `hr_admin`, ou clé Config `hrNotifyEmail`).

**Résultat attendu :**
```
==> Statut     : approved   (le dossier est validé)
==> Ligne sheet : row_xxxxxxxxxxxxxxxx  (identifiant de la ligne)
==> Email RH    : msg_xxxxxxxxxxxxxxxx  (vide si aucun destinataire RH configuré)
```

---

### Étape E — Vérifier les garde-fous (facultatif)

Ces tests vérifient que le serveur refuse ce qu'il doit refuser.
Les erreurs métier sont retournées dans le champ `errorCode` de la réponse (pas comme une erreur HTTP).

#### Test : mauvaise saisie → doit retourner VALIDATION_ERROR

```powershell
$rVal  = Invoke-RestMethod http://localhost:3000/mcp -Method POST -Headers $h -Body (
    ConvertTo-Json -Depth 5 @{
        jsonrpc = "2.0"; id = 20; method = "tools/call"
        params  = @{ name = "submit_job_request"; arguments = @{} }
    }
)
Write-Host "==> Code erreur : $(($rVal.result.content[0].text | ConvertFrom-Json).errorCode)"
```

**Résultat attendu :** `==> Code erreur : VALIDATION_ERROR`

---

#### Test : un employé essaie d'approuver → doit retourner FORBIDDEN

```powershell
# Ouvrir un nouveau dossier pour ce test
$rNew  = Invoke-RestMethod http://localhost:3000/mcp -Method POST -Headers $h -Body (
    ConvertTo-Json -Depth 5 @{
        jsonrpc = "2.0"; id = 30; method = "tools/call"
        params  = @{ name = "submit_job_request"; arguments = @{ title = "Test rôle"; justification = "test"; plannedHire = $false } }
    }
)
$newId = ($rNew.result.content[0].text | ConvertFrom-Json).data.processInstanceId

# Tenter l'approbation avec le rôle "employee"
$hEmp  = $h.Clone()
$hEmp["x-actor-id"]   = "pierre"
$hEmp["x-actor-role"] = "employee"

$rForbidden = Invoke-RestMethod http://localhost:3000/mcp -Method POST -Headers $hEmp -Body (
    ConvertTo-Json -Depth 5 @{
        jsonrpc = "2.0"; id = 31; method = "tools/call"
        params  = @{
            name      = "approve_job_description"
            arguments = @{ processInstanceId = $newId; idempotencyKey = "bad-1"; jobTitle = "Test" }
        }
    }
)
Write-Host "==> Code erreur : $(($rForbidden.result.content[0].text | ConvertFrom-Json).errorCode)"
```

**Résultat attendu :** `==> Code erreur : FORBIDDEN`

---

#### Test : anti-doublon — relancer generate deux fois → même résultat, aucun doublon

```powershell
# Ouvrir un nouveau dossier
$rD    = Invoke-RestMethod http://localhost:3000/mcp -Method POST -Headers $h -Body (
    ConvertTo-Json -Depth 5 @{
        jsonrpc = "2.0"; id = 45; method = "tools/call"
        params  = @{ name = "submit_job_request"; arguments = @{ title = "Test doublon"; justification = "test"; plannedHire = $false } }
    }
)
$dId   = ($rD.result.content[0].text | ConvertFrom-Json).data.processInstanceId

$genBody = ConvertTo-Json -Depth 5 @{
    jsonrpc = "2.0"; id = 41; method = "tools/call"
    params  = @{ name = "generate_job_description"; arguments = @{ processInstanceId = $dId; idempotencyKey = "idem-1"; targetSummary = "test" } }
}

$rG1   = Invoke-RestMethod http://localhost:3000/mcp -Method POST -Headers $h -Body $genBody
$rG2   = Invoke-RestMethod http://localhost:3000/mcp -Method POST -Headers $h -Body $genBody

$docId1 = ($rG1.result.content[0].text | ConvertFrom-Json).data.docId
$docId2 = ($rG2.result.content[0].text | ConvertFrom-Json).data.docId

Write-Host "==> Premier appel  : $docId1"
Write-Host "==> Deuxième appel : $docId2"
Write-Host "==> Identiques ?   : $($docId1 -eq $docId2)"
```

**Résultat attendu :** les deux `docId` sont identiques et `Identiques ? : True`.

---

## Test 3 (optionnel) — Écriture réelle dans Google Sheets

Ce test vérifie que l'approbation écrit une vraie ligne dans la feuille Google.

**Prérequis (voir README — section "Live Google Sheets") :**
1. Compte de service Google configuré, fichier `service-account.json` dans le dossier
2. Feuille partagée avec le compte de service (rôle Éditeur)
3. Onglets créés dans la feuille :
   - `rec_jobDesc` avec colonnes : `id | titre | mgr | url | status`
   - `proc_state` et `proc_audit` avec les colonnes listées dans le README

**Dans `.env`, ajouter ou modifier :**

```
GOOGLE_CONNECTORS=live
GOOGLE_SERVICE_ACCOUNT_JSON_FILE=service-account.json
STORAGE_BACKEND=sheets
```

Relancer le serveur (`npm run build && npm start`) et rejouer le scénario du Test 2.

**Ce qu'on vérifie dans Google Sheets après la commande 3 :**
- Un nouvelle ligne apparaît dans `rec_jobDesc`
- L'onglet `proc_audit` contient une ligne pour chaque étape (3 au total)
- L'onglet `proc_state` contient une ligne avec `currentStatus = approved`

> Pour tester uniquement l'écriture Sheets sans le stockage d'état, utiliser seulement `GOOGLE_CONNECTORS=live` (sans `STORAGE_BACKEND=sheets`).

---

## Récapitulatif des points de vérification

| Ce qu'on teste | Comment | Signe de succès |
|---|---|---|
| Tout le cœur (recommandé) | `npm test` | 45 verts, 0 erreur |
| Serveur vivant | GET `/healthz` | `ok : True` |
| Workflow complet (3 étapes) | Test 2 commandes 1–3 | statut passe à `approved` |
| Validation des entrées | Test 2 étape E — VALIDATION_ERROR | `Code erreur : VALIDATION_ERROR` |
| Contrôle de rôle | Test 2 étape E — FORBIDDEN | `Code erreur : FORBIDDEN` |
| Anti-doublon | Test 2 étape E — doublon | les deux `docId` sont identiques |
| Écriture Google Sheets | Test 3 | ligne visible dans `rec_jobDesc` |
