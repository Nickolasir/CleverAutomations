import React, { useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import type { User, Tenant, TenantId, UserId, MarketVertical, UserRole } from "@clever/shared";
import { supabase } from "./src/lib/supabase";
import { AuthContext, useAuthContext } from "./src/lib/auth-context";
export { useAuthContext } from "./src/lib/auth-context";

import LoginScreen from "./src/screens/LoginScreen";
import DashboardScreen from "./src/screens/DashboardScreen";
import AideSimplifiedNavigator from "./src/screens/aide/AideSimplifiedNavigator";
import AideDashboardScreen from "./src/screens/aide/AideDashboardScreen";
import AideMedicationsScreen from "./src/screens/aide/AideMedicationsScreen";
import AideAlertsScreen from "./src/screens/aide/AideAlertsScreen";
import AideWellnessScreen from "./src/screens/aide/AideWellnessScreen";
import AideProfileSetupScreen from "./src/screens/aide/AideProfileSetupScreen";
import AideRoutinesScreen from "./src/screens/aide/AideRoutinesScreen";
import DeviceControlScreen from "./src/screens/DeviceControlScreen";
import AddDeviceScreen from "./src/screens/AddDeviceScreen";
import DevicesListScreen from "./src/screens/DevicesListScreen";
import RoomsScreen from "./src/screens/RoomsScreen";
import ScenesScreen from "./src/screens/ScenesScreen";
import VoiceLogScreen from "./src/screens/VoiceLogScreen";
import GuestScreen from "./src/screens/GuestScreen";
import PantryScreen from "./src/screens/PantryScreen";
import NutritionScreen from "./src/screens/NutritionScreen";
import ShoppingListScreen from "./src/screens/ShoppingListScreen";
import AuditScreen from "./src/screens/AuditScreen";
import UsersScreen from "./src/screens/UsersScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import ChatScreen from "./src/screens/ChatScreen";
import FamilyScreen from "./src/screens/FamilyScreen";
import VoiceButton from "./src/components/VoiceButton";

/**
 * Root navigation type definitions.
 */
export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  AideMain: undefined;
  DeviceControl: { deviceId: string };
  AddDevice: undefined;
  AideDashboard: undefined;
  AideMedications: undefined;
  AideAlerts: undefined;
  AideWellness: undefined;
  AideProfileSetup: undefined;
  AideRoutines: undefined;
};

export type TabParamList = {
  DashboardTab: undefined;
  DevicesTab: undefined;
  ChatTab: undefined;
  RoomsTab: undefined;
  ScenesTab: undefined;
  MoreTab: undefined;
};

export type MoreStackParamList = {
  MoreMenu: undefined;
  VoiceLog: undefined;
  Family: undefined;
  Audit: undefined;
  Guests: undefined;
  Pantry: undefined;
  Nutrition: undefined;
  ShoppingList: undefined;
  Users: undefined;
  Settings: undefined;
  Profile: undefined;
  AideDashboard: undefined;
  AideMedications: undefined;
  AideAlerts: undefined;
  AideWellness: undefined;
  AideProfileSetup: undefined;
  AideRoutines: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();
const MoreStack = createNativeStackNavigator<MoreStackParamList>();

/** Role hierarchy for permission checks */
const ROLE_LEVEL: Record<UserRole, number> = {
  owner: 5,
  admin: 4,
  manager: 3,
  resident: 2,
  guest: 1,
};

/** Nav item for the More menu */
interface MoreNavItem {
  name: keyof MoreStackParamList;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  minRole?: UserRole;
  verticals?: MarketVertical[];
}

const MORE_NAV_ITEMS: MoreNavItem[] = [
  { name: "VoiceLog", label: "Voice Log", icon: "mic-outline" },
  { name: "Family", label: "Family", icon: "people-outline", verticals: ["clever_home"], minRole: "admin" },
  { name: "Guests", label: "Guests", icon: "people-outline", verticals: ["clever_host"] },
  { name: "Pantry", label: "ePantry", icon: "cube-outline" },
  { name: "Nutrition", label: "Nutrition", icon: "restaurant-outline", minRole: "resident" },
  { name: "ShoppingList", label: "Shopping List", icon: "cart-outline" },
  { name: "Audit", label: "Audit Log", icon: "shield-checkmark-outline", minRole: "admin" },
  { name: "Users", label: "Users", icon: "shield-outline", minRole: "admin", verticals: ["clever_host", "clever_building"] },
  { name: "Settings", label: "Settings", icon: "settings-outline", minRole: "admin" },
  { name: "Profile", label: "Profile", icon: "person-outline" },
  { name: "AideDashboard", label: "CleverAide", icon: "heart-outline", minRole: "admin" },
];

/** More menu screen — hub for all secondary screens */
function MoreMenuScreen() {
  const { user, tenant, signOut } = useAuthContext();
  const navigation = React.useRef<any>(null);
  const nav = require("@react-navigation/native").useNavigation();
  const insets = useSafeAreaInsets();
  const userRole = user?.role ?? "guest";
  const userLevel = ROLE_LEVEL[userRole];

  const visibleItems = MORE_NAV_ITEMS.filter((item) => {
    if (item.minRole && userLevel < ROLE_LEVEL[item.minRole]) return false;
    if (item.verticals && tenant && !item.verticals.includes(tenant.vertical)) return false;
    return true;
  });

  const initials = user?.display_name
    ? user.display_name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "??";

  const verticalLabel =
    tenant?.vertical === "clever_host"
      ? "CleverHost"
      : tenant?.vertical === "clever_building"
        ? "CleverBuilding"
        : "CleverHome";

  return (
    <ScrollView style={moreStyles.container} contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
      {/* User card */}
      <TouchableOpacity
        style={moreStyles.userCard}
        onPress={() => nav.navigate("Profile")}
        activeOpacity={0.7}
      >
        <View style={moreStyles.avatar}>
          <Text style={moreStyles.avatarText}>{initials}</Text>
        </View>
        <View style={moreStyles.userInfo}>
          <Text style={moreStyles.userName}>{user?.display_name ?? "User"}</Text>
          <Text style={moreStyles.userRole}>
            {userRole.charAt(0).toUpperCase() + userRole.slice(1)} · {verticalLabel}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#94a3b8" />
      </TouchableOpacity>

      {/* Tenant info */}
      {tenant && (
        <View style={moreStyles.tenantCard}>
          <View style={moreStyles.tenantLogoBox}>
            <Text style={moreStyles.tenantLogoText}>CA</Text>
          </View>
          <View style={moreStyles.tenantInfo}>
            <Text style={moreStyles.tenantName}>{tenant.name}</Text>
            <Text style={moreStyles.tenantTier}>
              {tenant.subscription_tier.charAt(0).toUpperCase() + tenant.subscription_tier.slice(1)} plan
            </Text>
          </View>
        </View>
      )}

      {/* Navigation items */}
      <View style={moreStyles.section}>
        {visibleItems.map((item) => (
          <TouchableOpacity
            key={item.name}
            style={moreStyles.menuItem}
            onPress={() => nav.navigate(item.name)}
            activeOpacity={0.7}
          >
            <View style={moreStyles.menuIconBox}>
              <Ionicons name={item.icon} size={20} color="#D4A843" />
            </View>
            <Text style={moreStyles.menuLabel}>{item.label}</Text>
            <Ionicons name="chevron-forward" size={18} color="#cbd5e1" />
          </TouchableOpacity>
        ))}
      </View>

      {/* Sign out */}
      <TouchableOpacity style={moreStyles.signOutBtn} onPress={signOut} activeOpacity={0.7}>
        <Ionicons name="log-out-outline" size={20} color="#dc2626" />
        <Text style={moreStyles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

/** More tab stack navigator */
function MoreStackNavigator() {
  return (
    <MoreStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: "#ffffff" },
        headerTitleStyle: { fontWeight: "700", fontSize: 18, color: "#1a1a1a" },
        headerTintColor: "#1a1a1a",
      }}
    >
      <MoreStack.Screen name="MoreMenu" component={MoreMenuScreen} options={{ title: "More" }} />
      <MoreStack.Screen name="VoiceLog" component={VoiceLogScreen} options={{ title: "Voice Log" }} />
      <MoreStack.Screen name="Family" component={FamilyScreen} options={{ title: "Family" }} />
      <MoreStack.Screen name="Audit" component={AuditScreen} options={{ title: "Audit Log" }} />
      <MoreStack.Screen name="Guests" component={GuestScreen} options={{ title: "Guests" }} />
      <MoreStack.Screen name="Pantry" component={PantryScreen} options={{ title: "ePantry" }} />
      <MoreStack.Screen name="Nutrition" component={NutritionScreen} options={{ title: "Nutrition" }} />
      <MoreStack.Screen name="ShoppingList" component={ShoppingListScreen} options={{ title: "Shopping List" }} />
      <MoreStack.Screen name="Users" component={UsersScreen} options={{ title: "Users" }} />
      <MoreStack.Screen name="Settings" component={SettingsScreen} options={{ title: "Settings" }} />
      <MoreStack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profile" }} />
      <MoreStack.Screen name="AideDashboard" component={AideDashboardScreen} options={{ title: "CleverAide" }} />
      <MoreStack.Screen name="AideMedications" component={AideMedicationsScreen} options={{ title: "Medications" }} />
      <MoreStack.Screen name="AideAlerts" component={AideAlertsScreen} options={{ title: "Alerts" }} />
      <MoreStack.Screen name="AideWellness" component={AideWellnessScreen} options={{ title: "Wellness" }} />
      <MoreStack.Screen name="AideProfileSetup" component={AideProfileSetupScreen} options={{ title: "Aide Setup" }} />
      <MoreStack.Screen name="AideRoutines" component={AideRoutinesScreen} options={{ title: "Routines" }} />
    </MoreStack.Navigator>
  );
}

/** Bottom tab navigator */
function MainTabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: "#D4A843",
        tabBarInactiveTintColor: "#94a3b8",
        tabBarStyle: {
          backgroundColor: "#ffffff",
          borderTopColor: "#e2e8f0",
          paddingBottom: Math.max(insets.bottom, 8),
          height: 56 + Math.max(insets.bottom, 8),
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        headerStyle: { backgroundColor: "#ffffff" },
        headerTitleStyle: { fontWeight: "700", fontSize: 18, color: "#1a1a1a" },
        headerTintColor: "#1a1a1a",
      }}
    >
      <Tab.Screen
        name="DashboardTab"
        component={DashboardScreen}
        options={{
          title: "Dashboard",
          tabBarLabel: "Home",
          tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="DevicesTab"
        component={DevicesListScreen}
        options={{
          title: "Devices",
          tabBarIcon: ({ color, size }) => <Ionicons name="hardware-chip-outline" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="ChatTab"
        component={ChatScreen}
        options={{
          title: "Chat",
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="RoomsTab"
        component={RoomsScreen}
        options={{
          title: "Rooms",
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="ScenesTab"
        component={ScenesScreen}
        options={{
          title: "Scenes",
          tabBarIcon: ({ color, size }) => <Ionicons name="play-outline" size={size} color={color} />,
        }}
      />
      <Tab.Screen
        name="MoreTab"
        component={MoreStackNavigator}
        options={{
          title: "More",
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Ionicons name="ellipsis-horizontal" size={size} color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

/**
 * Root App component.
 * Manages authentication state and provides navigation structure.
 */
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAssistedLiving, setIsAssistedLiving] = useState(false);

  useEffect(() => {
    const loadSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          await loadUserProfile(session.user.id);
        }
      } catch (error) {
        console.error("Failed to load session:", error);
      } finally {
        setLoading(false);
      }
    };

    void loadSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT") {
        setUser(null);
        setTenant(null);
      } else if (session?.user) {
        await loadUserProfile(session.user.id);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const loadUserProfile = async (authUserId: string) => {
    const { data: profile } = await supabase
      .from("users")
      .select("*")
      .eq("id", authUserId as unknown as UserId)
      .single();

    if (profile) {
      setUser(profile as unknown as User);

      const { data: tenantData } = await supabase
        .from("tenants")
        .select("*")
        .eq("id", profile.tenant_id as unknown as TenantId)
        .single();

      if (tenantData) {
        setTenant(tenantData as unknown as Tenant);
      }

      // Check if this user has an assisted_living family profile
      const { data: familyProfile } = await supabase
        .from("family_member_profiles")
        .select("age_group")
        .eq("user_id", authUserId)
        .eq("is_active", true)
        .single();

      setIsAssistedLiving(familyProfile?.age_group === "assisted_living");
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setTenant(null);
    setIsAssistedLiving(false);
  };

  if (loading) {
    return (
      <SafeAreaProvider>
        <View style={styles.loadingContainer}>
          <View style={styles.loadingLogo}>
            <Ionicons name="home" size={32} color="#ffffff" />
          </View>
          <ActivityIndicator size="large" color="#D4A843" style={{ marginTop: 24 }} />
          <Text style={styles.loadingText}>Loading CleverHub...</Text>
          <StatusBar style="auto" />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
    <AuthContext.Provider value={{ user, tenant, signOut }}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {!user ? (
            <Stack.Screen name="Login" component={LoginScreen} />
          ) : isAssistedLiving ? (
            <>
              <Stack.Screen name="AideMain" component={AideSimplifiedNavigator} />
            </>
          ) : (
            <>
              <Stack.Screen name="Main" component={MainTabs} />
              <Stack.Screen
                name="DeviceControl"
                component={DeviceControlScreen}
                options={{
                  headerShown: true,
                  title: "Device Control",
                  headerStyle: { backgroundColor: "#ffffff" },
                  headerTintColor: "#1a1a1a",
                  presentation: "modal",
                }}
              />
              <Stack.Screen
                name="AddDevice"
                component={AddDeviceScreen}
                options={{
                  headerShown: true,
                  title: "Add Device",
                  headerStyle: { backgroundColor: "#ffffff" },
                  headerTintColor: "#1a1a1a",
                  presentation: "modal",
                }}
              />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
      {user && <VoiceButton />}
      <StatusBar style="auto" />
    </AuthContext.Provider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FDF6E3",
  },
  loadingLogo: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: "#D4A843",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: "#64748b",
  },
});

const moreStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FDF6E3",
    padding: 16,
  },
  userCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginBottom: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#D4A843",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
  },
  userInfo: { flex: 1 },
  userName: { fontSize: 16, fontWeight: "700", color: "#1a1a1a" },
  userRole: { fontSize: 13, color: "#64748b", marginTop: 2 },

  tenantCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1F1F1F",
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  tenantLogoBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#D4A843",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  tenantLogoText: { fontSize: 14, fontWeight: "700", color: "#ffffff" },
  tenantInfo: { flex: 1 },
  tenantName: { fontSize: 14, fontWeight: "700", color: "#ffffff" },
  tenantTier: { fontSize: 12, color: "#94a3b8", marginTop: 2 },

  section: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    overflow: "hidden",
    marginBottom: 16,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  menuIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#FFF8E1",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  menuLabel: { flex: 1, fontSize: 15, fontWeight: "500", color: "#1a1a1a" },

  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#fef2f2",
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  signOutText: { fontSize: 15, fontWeight: "600", color: "#dc2626" },
});
