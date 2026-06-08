# Guide utilisateur — DRH (non technique)

Comment vous connecter à l'assistant RH et l'utiliser pour produire une **fiche de poste**, puis
comment entretenir vos deux onglets dans le Google Sheet. Pas de code, pas de serveur — votre
prestataire (l'« opérateur ») s'occupe de la technique et vous remet une **clé** (un jeton).

## 1. Ce que fait l'assistant

Vous décrivez un besoin de recrutement en langage naturel ; l'assistant :
1. enregistre la **demande** (manager),
2. **rédige** la fiche de poste dans un Google Doc partagé,
3. l'**approuve** (manager) — la fiche est tracée dans le Google Sheet et **les RH reçoivent un
   e-mail** automatiquement.

Tout passe par un système sécurisé qui vérifie qui vous êtes, votre rôle, et qui journalise chaque
action. Vous ne pouvez pas « sauter » une étape de validation : l'IA propose, un humain valide.

## 2. Se connecter

Vous avez **deux** façons de vous connecter. Choisissez celle qui vous convient — l'opérateur vous
donne la bonne clé pour chacune.

### Option A — claude.ai dans le navigateur (le plus simple, rien à installer)

1. Demandez à l'opérateur votre **jeton personnel** (il le génère pour votre e-mail).
2. Sur **claude.ai** → **Settings → Connectors → Add custom connector**.
3. **URL :** `https://hris-mcp.sourcinno.com/mcp`
4. **Authentification :** collez votre **jeton** (bearer token).
5. Enregistrez. Les outils RH apparaissent.

> Votre jeton vous identifie déjà : inutile de saisir votre nom ou votre rôle. Ne le partagez avec
> personne — il agit en votre nom.
> *(Prérequis technique côté opérateur : le site doit être en HTTPS. Si la connexion échoue,
> l'opérateur doit activer le certificat TLS.)*

### Option B — Claude Desktop (application installée)

L'opérateur ajoute pour vous un bloc dans la configuration de l'application (avec la clé de
l'entreprise et votre e-mail/rôle). Vous n'avez rien à régler ; après redémarrage, les outils RH
apparaissent. Détails pour l'opérateur : [pilot-access.md](pilot-access.md).

## 3. Lancer le flux (exemple)

Dites simplement, en français : **« J'ai besoin de recruter un… »**. L'assistant vous guide :

1. **Demande** — il vous demande l'intitulé, une justification, si l'embauche est planifiée.
2. **Rédaction** — il génère la fiche dans un Google Doc (lien partagé, ouvrable par le manager et
   les RH du dossier Drive).
3. **Approbation** — le **manager** approuve. La fiche est enregistrée et **les RH sont prévenus
   par e-mail**.

Si vous réessayez une action déjà faite (par ex. ré-approuver), le système la **bloque** proprement
— c'est normal, c'est la sécurité.

## 4. Entretenir vos onglets dans le Google Sheet

Le Google Sheet est partagé entre vous (RH) et le système. **Vous pouvez modifier deux choses**,
et il y a des choses à **ne pas toucher**.

### ✅ Vous POUVEZ modifier (sans rien redéployer)

- **Onglet `Users`** — une ligne par personne : **`email | rôle`**.
  Exemple : `marie.dupont@acme.com | manager`, `drh@acme.com | hr_admin`.
  Pour changer le rôle de quelqu'un, modifiez sa ligne ; l'effet est pris en compte en ~1 minute.
  Gardez **au moins un `hr_admin`** : il reçoit l'e-mail d'approbation (un `admin_user`, le rôle de
  test, le reçoit aussi).
  Rôles possibles : `manager`, `hr_admin`, `employee`, et `admin_user` (testeur/admin avec accès
  complet aux outils). **Une seule ligne par e-mail** (un e-mail = un rôle) : pour un testeur qui a
  besoin d'un accès large, utilisez `admin_user` plutôt que de dupliquer l'e-mail. L'accès aux
  Google Drive/Sheets reste **géré séparément** (partage Google / groupe Google), pas par ce rôle.
- **Onglet `Config`** — uniquement les **valeurs** des réglages connus (pas les noms) :

  | Réglage | Effet quand `true` |
  |---|---|
  | `requireJustification` | insiste pour obtenir une justification |
  | `requireProofDoc` | exige un document justificatif avant l'approbation |
  | `extraValidationStep` | ajoute une confirmation humaine supplémentaire |
  | `requireStructuredSections` | exige les 4 sections (mission/responsabilités/profil/contexte) |
  | `hrNotifyEmail` | e-mail RH de secours si aucun `hr_admin` dans `Users` |

### ⛔ Ne PAS toucher (sans effet, ou ça casse la lecture)

- Les **noms des onglets** et les **lignes d'en-tête** : `rec_jobDesc`, `proc_state`, `proc_audit`
  (et les en-têtes de `Users` / `Config`). Le système lit par nom d'onglet et par colonnes — les
  renommer le casse.
- **N'inventez pas de nouvelle clé** dans `Config` : toute clé inconnue est **ignorée**. Et
  surtout : une clé `Config` ne peut **jamais** donner un rôle à quelqu'un — les rôles se gèrent
  **uniquement** dans l'onglet `Users`.

## 5. En cas de souci

| Ce que vous voyez | Que faire |
|---|---|
| « Non authentifié » / connexion refusée | Votre clé/jeton est invalide ou expiré — redemandez-en un à l'opérateur. |
| « Action non autorisée » | Votre rôle ne permet pas cette action ; vérifiez votre ligne dans `Users`. |
| L'e-mail RH n'arrive pas | Vérifiez qu'il y a bien une ligne `hr_admin` dans `Users` (ou `hrNotifyEmail` dans `Config`). |
| La connexion claude.ai web échoue | Le site doit être en HTTPS — c'est à activer côté opérateur. |
| Le lien du Doc ne s'ouvre pas | Le dossier Drive doit être partagé avec vous/les RH ; signalez-le à l'opérateur. |

Pour toute configuration technique, voyez le [guide développeur](developer-guide.md).
