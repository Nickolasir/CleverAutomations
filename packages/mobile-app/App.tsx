import React, { useEffect, useState, createContext, useContext } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View, StyleSheet, Text } from "react-native";
import type { User, Tenant, TenantId, UserId } from "@clever/shared";
import { supabase } from "./src/lib/supabase";

import LoginScreen from "./src/screens/LoginScreen";
import DashboardScreen from "./src/screens/DashboardScreen";
import DeviceControlScreen from "./src/screens/DeviceControlScreen";
import GuestScreen from "./src/screens/GuestScreen";

/**
 * Root navigation type definitions.
 * Using strict typing for type-safe navigation params.
 */
export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  DeviceControl: { deviceId: string };
};

export type MainTabParamList = {
  Dashboard: undefined;
  Guests: undefined;
};

/** Auth context shared across all screens */
interface AuthContextValue {
  user: User | null;
  tenant: Tenant | null;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  tenant: null,
  signOut: async () => {},
});

export function useAuthContext(): AuthContextValue {
  return useContext(AuthContext);
}

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

/** Bottom tab navigator for authenticated screens */
function MainTabs() {
  const { tenant } = useAuthContext();
  const showGuests = tenant?.vertical === "clever_host";

  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: "#2563eb",
        tabBarInactiveTintColor: "#94a3b8",
        tabBarStyle: {
          backgroundColor: "#ffffff",
          borderTopColor: "#e2e8f0",
          paddingBottom: 4,
          height: 56,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "600",
        },
        headerStyle: {
          backgroundColor: "#ffffff",
        },
        headerTitleStyle: {
          fontWeight: "700",
          fontSize: 18,
          color: "#0f172a",
        },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          title: "Devices",
          tabBarIcon: ({ color, size }) => (
            <Text style={{ fontSize: size, color }}>{"grid"}</Text>
          ),
        }}
      />
      {showGuests && (
        <Tab.Screen
          name="Guests"
          component={GuestScreen}
          options={{
            title: "Guests",
            tabBarIcon: ({ color, size }) => (
              <Text style={{ fontSize: size, color }}>{"people"}</Text>
            ),
          }}
        />
      )}
    </Tab.Navigator>
  );
}

/**
 * Root App component.
 * Manages authentication state and provides navigation structure.
 * Unauthenticated users see LoginScreen; authenticated users see the main tab navigator.
 */
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    /** Check for existing session on app start */
    const loadSession = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

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

    /** Listen for auth state changes */
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
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

  /** Load user profile and tenant from Supabase */
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
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setTenant(null);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Loading Clever Automations...</Text>
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <AuthContext.Provider value={{ user, tenant, signOut }}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {!user ? (
            <Stack.Screen name="Login" component={LoginScreen} />
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
                  headerTintColor: "#0f172a",
                  presentation: "modal",
                }}
              />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
      <StatusBar style="auto" />
    </AuthContext.Provider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f8fafc",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: "#64748b",
  },
});
