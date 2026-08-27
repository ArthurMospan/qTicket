'use client';
import MaterialCard from './MaterialCard';

export default function MaterialGrid({ materials, onOpen }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {materials.map((m) => <MaterialCard key={m.id} raw={m} onOpen={onOpen} />)}
    </div>
  );
}
