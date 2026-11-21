/**
 * Matriz de Verificación de Seguridad TDD — PoliCircular (Firestore Rules)
 * Valida estructuralmente que firestore.rules cumpla los 8 Pilares de Seguridad
 * y los 12 casos de prueba de la especificación (security_spec.md).
 *
 * Ejecutar: npx tsx firestore.rules.test.ts
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const rules = fs.readFileSync('firestore.rules', 'utf-8');

function check(name: string, condition: boolean) {
  assert.ok(condition, `Fallo en regla de seguridad: ${name}`);
  console.log(`✔ ${name}`);
}

// 1. Default Deny Global
check('Default deny match /{document=**}', rules.includes('match /{document=**}') && rules.includes('allow read, write: if false;'));

// 2. Connectivity test/connection ping
check('Connectivity ping /test/{docId}', rules.includes('match /test/{docId}') && rules.includes("allow get: if docId == 'connection';"));

// 3. No wildcards o if true abiertos en colecciones sensibles
check('Sin allow read, write: if true', !/allow\s+(read|write)\s*:\s*if\s+true\s*;/.test(rules));

// 4. Aislamiento de PII en subcolección private
check('PII privada aislada en /users/{userId}/private/{contactDoc}', rules.includes('match /private/{contactDoc}') && rules.includes('isOwner(userId) || isAdmin()'));

// 5. Prevención de auto-escalada de privilegios en user_roles
check('Solo super_admin puede asignar roles en user_roles', rules.includes('match /user_roles/{userId}') && rules.includes('allow create, update: if isSuperAdmin()'));

// 6. Pre-moderación estricta al crear producto
check('Productos creados siempre inician en pending', rules.includes("incoming().status == 'pending'"));

// 7. Mensajes inmutables y validación de bloqueo en conversaciones
check('Mensajes bloqueados validan is_blocked == false y sender_id == auth.uid', rules.includes('is_blocked == false') && rules.includes('incoming().sender_id == request.auth.uid'));

// 8. Confirmación automática obligatoria para completar intercambio
check('Completar intercambio exige confirmación registrada del participante', rules.includes("exchange_confirmations/$(exchangeId + '_' + request.auth.uid)"));

// 9. Reseñas solo sobre intercambios completed y sin auto-reseña
check('Reseña exige exchange completed y reviewer != reviewed_user', rules.includes("data.status == 'completed'") && rules.includes('data.reviewer_id != data.reviewed_user_id'));

// 10. Árbol circular e impacto vinculados al exchange completed
check('Progreso del árbol e impacto vinculados atómicamente al exchange completed', rules.includes('last_exchange_id') && rules.includes('impactId == incoming().exchange_id'));

// 11. Verificación de correo requerida para acciones comunitarias
check('Escrituras comunitarias exigen isVerifiedUser()', rules.includes('request.auth.token.email_verified == true'));

// 12. Timestamps de servidor (request.time)
check('Timestamps validados contra request.time', rules.includes('== request.time'));

// 13. Semilla territorial en batch usa existsAfter en sectors
check(
  'Creación de sectores en batch usa existsAfter para comunas',
  rules.includes('existsAfter(/databases/$(database)/documents/communes/$(incoming().commune_id))')
);

// 14. Lecturas get nulas seguras (resource == null) en colecciones privadas/participantes
for (const col of [
  'users',
  'product_interests',
  'match_requests',
  'matches',
  'conversations',
  'messages',
  'exchanges',
  'exchange_confirmations',
  'reports',
  'notifications',
  'education_progress',
]) {
  const blockMatch = rules.match(new RegExp(`match /${col}/\\{[^}]+\\}[\\s\\S]*?allow get:[^;]+;`));
  check(
    `allow get en /${col} soporta resource == null`,
    Boolean(blockMatch && blockMatch[0].includes('resource == null'))
  );
}

// 15. Moderadores pueden listar usuarios en panel administrativo
const usersBlock = rules.match(/match \/users\/\{userId\}[\s\S]*?allow list:[^;]+;/);
check('Moderadores autorizados para listar /users', Boolean(usersBlock && usersBlock[0].includes('isModerator()')));

// 16. Servicios de chat y matching filtran por participante en queries de Firestore
const chatSrc = fs.readFileSync('src/services/chatService.ts', 'utf-8');
const matchingSrc = fs.readFileSync('src/services/matchingService.ts', 'utf-8');
check(
  'chatService filtra conversations y messages por participant_a/participant_b',
  chatSrc.includes("where('participant_a', '=='") && chatSrc.includes("where('participant_b', '=='")
);
check(
  'matchingService filtra hydrateMatchDocs en conversations, exchanges y exchange_confirmations',
  matchingSrc.includes("where('participant_a', '=='") &&
    matchingSrc.includes('where(roleField')
);

console.log('\nTodos los invariantes de firestore.rules superaron la verificación TDD.');
