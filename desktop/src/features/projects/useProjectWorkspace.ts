import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppNotice, AppSnapshot, AppStateSetter } from "../shared/appTypes";
import type { Project } from "../shared/projectTypes";
import { useMemo, useState } from "react";

export function useProjectWorkspace({ setActiveNav, setLoading, setNotice, setSnapshot }: {
  setActiveNav: AppStateSetter<string>;
  setLoading: AppStateSetter<boolean>;
  setNotice: AppNotice;
  setSnapshot: AppStateSetter<AppSnapshot>;
}) {
  const [projects, setProjects] = useState<Project[]>([]);

  const [selectedProjectId, setSelectedProjectId] = useState("");

  const [showProjectForm, setShowProjectForm] = useState(false);

  const [projectName, setProjectName] = useState("Demo Video Project");

  const [workspaceRoot, setWorkspaceRoot] = useState("D:\\Auto3Dvideo\\projects\\demo-video");

  const selectedProject = useMemo(
    () => projects.find((project) => project.projectId === selectedProjectId),
    [projects, selectedProjectId],
  );

  async function createProject() {
    setLoading(true);
    try {
      const created = await invoke<Project>("create_project", { name: projectName, workspaceRoot });
      setProjects((current) => [created, ...current]);
      setSelectedProjectId(created.projectId);
      setSnapshot((current) => ({ ...current, projectCount: current.projectCount + 1 }));
      setNotice(`Đã tạo project “${created.name}” với locale vi-VN và policy safe-local.`);
      setShowProjectForm(false);
      setActiveNav("recipes");
    } catch {
      setNotice("Không tạo được project. Kiểm tra tên và workspace path.");
    } finally {
      setLoading(false);
    }
  }

  async function deleteProject(project: Project) {
    const confirmed = window.confirm(`Xóa project “${project.name}”?\n\nDữ liệu project và các bản ghi liên quan sẽ bị xóa khỏi SQLite. Thư mục workspace trên ổ đĩa sẽ không bị xóa.`);
    if (!confirmed) return;
    setLoading(true);
    try {
      await invoke("delete_project", { projectId: project.projectId });
      const remaining = projects.filter((item) => item.projectId !== project.projectId);
      setProjects(remaining);
      if (project.projectId === selectedProjectId) {
        const nextProject = remaining[0];
        setSelectedProjectId(nextProject?.projectId ?? "");
        if (!nextProject) setActiveNav("overview");
      }
      setSnapshot((current) => ({ ...current, projectCount: Math.max(0, current.projectCount - 1) }));
      setNotice(`Đã xoá project “${project.name}”. Thư mục workspace vẫn được giữ nguyên.`);
    } catch (error) {
      setNotice(typeof error === "string" ? error : "Không xoá được project.");
    } finally {
      setLoading(false);
    }
  }

  async function chooseWorkspace() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Chọn thư mục không gian làm việc",
      });
      if (typeof selected === "string") {
        setWorkspaceRoot(selected);
        setNotice("Đã chọn thư mục workspace; hãy kiểm tra lại trước khi tạo project.");
      }
    } catch {
      setNotice("Không mở được hộp thoại chọn thư mục.");
    }
  }

  async function loadProjects() {
    return invoke<Project[]>("list_projects");
  }
  return {
    loadProjects,
    chooseWorkspace,
    createProject,
    deleteProject,
    projectName,
    projects,
    selectedProject,
    selectedProjectId,
    setProjectName,
    setProjects,
    setSelectedProjectId,
    setShowProjectForm,
    setWorkspaceRoot,
    showProjectForm,
    workspaceRoot,
  };
}
