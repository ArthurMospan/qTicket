'use client';

// src/lib/hooks/useStagesForProject.js — Real-time stages + their materials
import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, onSnapshot, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
export function useStagesForProject(projectId) {
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!projectId) {
      queueMicrotask(() => setLoading(false));
      return;
    }
    const q = query(collection(db, 'stages'), where('projectId', '==', projectId));
    const unsub = onSnapshot(q, async snap => {
      const stagesData = snap.docs.map(d => ({
        ...d.data(),
        id: d.id,
      }));
      stagesData.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

      // Load materials for each stage
      const withMaterials = await Promise.all(stagesData.map(async stage => {
        try {
          const matSnap = await getDocs(collection(db, 'stages', stage.id, 'materials'));
          const materials = matSnap.docs.map(d => ({
            ...d.data(),
            id: d.id,
          }));
          return {
            ...stage,
            materials
          };
        } catch {
          return {
            ...stage,
            materials: []
          };
        }
      }));
      setStages(withMaterials);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [projectId]);
  return {
    stages,
    loading
  };
}
