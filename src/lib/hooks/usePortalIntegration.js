'use client';

// src/lib/hooks/usePortalIntegration.js
// Reads data from portal collections (stages/materials + project messages)
// CLIENT-FACING data — read only from workspace side
import { useState, useEffect } from 'react';
import { collection, doc, query, limit, onSnapshot, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

// ── Fetch single material by (stageId, materialId) or just stageId ────────────
export function usePortalMaterial(linkedId) {
  const [material, setMaterial] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!linkedId) {
      queueMicrotask(() => setLoading(false));
      return;
    }
    const parts = linkedId.split('/');
    let ref;
    if (parts.length === 2) {
      ref = doc(db, 'stages', parts[0], 'materials', parts[1]);
    } else {
      ref = doc(db, 'stages', linkedId);
    }
    getDoc(ref).then(snap => {
      setMaterial(snap.exists() ? {
        ...snap.data(),
        id: snap.id,
      } : null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [linkedId]);
  return {
    material,
    loading
  };
}

// ── Stream last 60 messages from portal project chat ─────────────────────────
// NO orderBy — avoids composite index requirement. Sort client-side.
export function usePortalChat(projectId) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!projectId) {
      queueMicrotask(() => setLoading(false));
      return;
    }

    // Query without orderBy to avoid needing a Firestore composite index
    const q = query(collection(db, 'projects', projectId, 'messages'), limit(60));
    const unsub = onSnapshot(q, snap => {
      const msgs = snap.docs.map(d => ({
        ...d.data(),
        id: d.id,
      }));
      // Sort client-side: oldest first (ascending createdAt)
      msgs.sort((a, b) => {
        const aT = a.createdAt?.toMillis?.() ?? a.timestamp?.toMillis?.() ?? 0;
        const bT = b.createdAt?.toMillis?.() ?? b.timestamp?.toMillis?.() ?? 0;
        return aT - bT;
      });
      setMessages(msgs);
      setLoading(false);
    }, err => {
      console.warn('[usePortalChat] error:', err.message);
      setLoading(false);
    });
    return () => unsub();
  }, [projectId]);

  // Send a reply from the team (visible in both WS and QT portal)
  const sendPortalMessage = async (text, sender) => {
    if (!projectId || !text?.trim()) return;
    const {
      addDoc,
      serverTimestamp
    } = await import('firebase/firestore');
    await addDoc(collection(db, 'projects', projectId, 'messages'), {
      text: text.trim(),
      senderName: sender?.name || 'Команда',
      senderId: sender?.uid || sender?.id || null,
      senderRole: 'team',
      createdAt: serverTimestamp()
    });
  };
  return {
    messages,
    loading,
    sendPortalMessage
  };
}

// ── Stage (client project) info ───────────────────────────────────────────────
export function usePortalStage(stageId) {
  const [stage, setStage] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!stageId) {
      queueMicrotask(() => setLoading(false));
      return;
    }
    getDoc(doc(db, 'stages', stageId)).then(snap => {
      setStage(snap.exists() ? {
        ...snap.data(),
        id: snap.id,
      } : null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [stageId]);
  return {
    stage,
    loading
  };
}
