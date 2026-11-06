import { useState } from 'react';
import type { CapabilityBot } from './NativeHub.tsx';
import type { ServiceTab } from './types.ts';

export type SettingsTab = 'model' | 'voice' | 'memory' | 'appearance';
export type NativeTab = 'goals' | 'skills' | 'access';
export type Surface = { kind: 'browser' | 'computer'; bot: CapabilityBot };

/** Which drawer, dialog or live surface is open on top of the room. */
export function useOverlays() {
  const [settings, setSettings] = useState<SettingsTab | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [servicesTab, setServicesTab] = useState<ServiceTab | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [nativeOpen, setNativeOpen] = useState(false);
  const [nativeTab, setNativeTab] = useState<NativeTab>('skills');
  const [nativeBot, setNativeBot] = useState<string>();
  const [surface, setSurface] = useState<Surface | null>(null);
  const openNative = (tab: NativeTab) => {
    setNativeTab(tab);
    setNativeOpen(true);
  };
  const managePermissions = (botId: string) => {
    setNativeBot(botId);
    setNativeTab('access');
    setNativeOpen(true);
  };
  return {
    settings,
    setSettings,
    statusOpen,
    setStatusOpen,
    servicesTab,
    setServicesTab,
    teamOpen,
    setTeamOpen,
    nativeOpen,
    setNativeOpen,
    nativeTab,
    nativeBot,
    surface,
    setSurface,
    openNative,
    managePermissions,
  };
}
