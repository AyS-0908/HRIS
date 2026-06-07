# Micro-spec module metier

Template pour creer un nouveau module metier avec un IA-codeur.

But : partir d'une description metier simple, puis laisser l'IA-codeur traduire en module MCP conforme. L'operateur n'a pas besoin de connaitre les noms d'outils, les statuts techniques, les schemas ou les fichiers.

## 0. Regles pour l'IA-codeur

Avant de proposer du code, lire et appliquer :

- [AGENTS.md](../AGENTS.md) pour les invariants verrouilles.
- [SPEC.md](../SPEC.md) pour les contrats exacts.
- [docs/developer-guide.md](developer-guide.md) section 4 pour la procedure d'ajout de module.
- Le module reference [src/modules/hr/recruitment/](../src/modules/hr/recruitment/).

Ne pas redemander ce qui est deja impose par l'architecture :

- Pas de modification de `core/`, `runtime/` ou `server/`.
- Chemin module : `src/modules/{domain}/{process}/`.
- Handler -> service -> connector, jamais handler -> connector.
- Identite depuis `RequestContext`, jamais deduite ailleurs.
- Validation zod seulement ; schema MCP derive.
- Statuts, permissions, idempotence et audit geres par le runtime.
- Stockage via `StorageAdapter`.
- Tests : `npm run check-standard` + `npm test`.

Quand l'operateur ne sait pas repondre :

- Proposer 2 ou 3 options simples.
- Mettre l'option recommandee en premier.
- Expliquer le compromis en une phrase.
- Si la question est technique et sans impact metier fort, choisir soi-meme l'option la plus simple.
- Si l'action est irreversible ou externe, ne pas choisir seul : demander confirmation.

## 1. Entree minimale attendue de l'operateur

Remplir seulement ce qui est connu.

```text
Nom metier du processus :
Exemple : Publication d'une fiche de poste

Objectif en une phrase :
Exemple : Preparer et diffuser une fiche de poste sur plusieurs canaux.

Tableau du processus utilisateur :

Qui | Etape metier | Ce qui est fourni | Ce qui doit etre produit | Colonnes Google Sheets connues
--- | --- | --- | --- | ---
RH | Definit les canaux de publication | email, reseaux sociaux, job boards | canaux choisis | channels, deadline
IA | Redige les messages par canal | fiche de poste + canaux | brouillons de messages | email_text, linkedin_text, jobboard_text
RH | Valide les messages | brouillons | approuve ou demande correction | status, reviewer_comment
Systeme/IA | Prepare ou effectue la diffusion | messages approuves | liens/statut de diffusion | published_urls, published_at

Contraintes connues :
- Exemple : RH doit toujours valider avant diffusion.
- Exemple : LinkedIn doit rester brouillon, pas publication automatique.

Exemples de donnees si disponibles :
- Exemple d'une ligne Google Sheets.
- Exemple d'un message attendu.
- Exemple d'un cas refuse.
```

## 2. Questions que l'IA doit poser

L'IA ne doit poser que les questions non-evidentes. Elle doit eviter les details deja couverts par l'architecture.

### 2.1 Perimetre

Questions :

- Le module doit-il seulement preparer le travail, ou aussi agir dans des outils externes ?
- Le processus cree-t-il un nouveau dossier/processus, ou continue-t-il un processus existant ?
- Ce module est-il separe du module existant `hr.recruitment` ?

Defaut recommande si incertain :

- Module separe.
- Preparation d'abord, action externe seulement apres validation humaine.

### 2.2 Acteurs et validations humaines

Questions :

- Qui peut lancer le processus ?
- Qui peut valider ?
- L'IA a-t-elle le droit de finaliser seule une etape ?

Defaut recommande si incertain :

- RH lance et valide.
- L'IA produit des brouillons/recommandations.
- Toute validation finale est humaine.

### 2.3 Donnees et Google Sheets

Questions :

- Quelle feuille ou quel onglet contient les donnees ?
- Quelles colonnes RH peut modifier ?
- Quelles colonnes le systeme remplit ?
- Quelles colonnes ne doivent pas etre renommees ?

Defaut recommande si incertain :

- Garder un onglet dedie au module.
- Separer les colonnes d'entree RH des colonnes produites par le systeme.
- Ne pas utiliser une colonne pour donner des droits ; les roles restent dans la config entreprise / `Users`.

### 2.4 Sorties et effets externes

Questions :

- Faut-il creer un Google Doc ?
- Faut-il envoyer un email ?
- Faut-il publier vraiment sur un job board, ou seulement preparer le contenu ?
- Faut-il appeler une API externe non encore connectee ?

Defaut recommande si incertain :

- Google Sheets / Google Docs / Gmail si deja disponibles.
- Pour job boards, reseaux sociaux ou API non branchee : mode preparation/simulation, pas publication reelle.

### 2.5 Regles metier

Questions :

- Qu'est-ce qui rend une etape valide ou invalide ?
- Quelles erreurs doivent bloquer ?
- Quelles erreurs sont seulement informatives ?
- Y a-t-il un delai, une date limite, une langue, un ton, une charte ?

Defaut recommande si incertain :

- Bloquer les donnees manquantes indispensables.
- Laisser les preferences editoriales configurables.
- Garder les echecs de notification en "best effort" seulement si le metier accepte de continuer sans notification.

### 2.6 Tracabilite

Questions :

- Quelles actions doivent absolument etre historisees ?
- Quelles donnees sont sensibles et ne doivent pas apparaitre en clair dans les logs ?

Defaut recommande si incertain :

- Audit standard pour les etapes normales.
- Audit strict pour validation, publication, email, ou action externe.
- Ne jamais logger de secrets, tokens, contenu confidentiel inutile.

## 3. Sortie attendue de l'IA avant codage

L'IA doit produire cette micro-spec finale et demander confirmation si elle contient une action externe ou irreversible.

```text
Module :
- Domaine :
- Process :
- Nom module :
- Objectif :

Processus metier retenu :
Qui | Etape | Decision humaine ? | Donnees lues | Donnees produites
--- | --- | --- | --- | ---

Outils MCP proposes :
Outil | Role principal | Action metier | Statut avant | Statut apres | Effets externes
--- | --- | --- | --- | --- | ---

Statuts proposes :
- ...

Permissions proposees :
- ...

Contrat Google Sheets :
- Onglets :
- Colonnes RH modifiables :
- Colonnes systeme :
- Colonnes interdites a renommer :

Connecteurs utilises :
- Sheets :
- Docs :
- Gmail :
- Autre :

Choix faits par l'IA car l'operateur ne savait pas :
- ...

Questions encore bloquantes :
- Aucune / ...

Plan de verification :
- `npm run check-standard`
- `npm test`
- Test manuel du parcours principal
- Test d'une action interdite
- Test anti-doublon si l'outil a un effet externe
```

## 4. Exemple court : HR publishing

Entree operateur :

```text
RH / Definit le canal de publication / email, reseaux sociaux, job boards / colonnes channels, deadline
IA / Redige les messages par canal selectionne / colonnes email_text, linkedin_text, jobboard_text
RH / Valide les messages / colonnes status, reviewer_comment
Systeme / Prepare la diffusion / colonnes published_urls, published_at
```

Traduction possible par l'IA :

```text
Module : hr.publishing

Outils :
- configure_publication_channels
- draft_channel_messages
- approve_publication_messages
- prepare_publication_package

Statuts :
- channels_defined
- messages_drafted
- messages_approved
- publication_prepared

Decision de securite :
- Pas de vraie publication externe au debut.
- Le module prepare les contenus et liens.
- La publication reelle devient une etape future si un connecteur fiable existe.
```

